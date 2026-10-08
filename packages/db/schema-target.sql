-- First migration draft for the store platform (Postgres on Supabase).
-- Money is integer minor units + currency. Times are timestamptz (UTC).
-- Access: row level security. A user can touch a row only if they are a member of its shop.

create extension if not exists pgcrypto;

create table shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  handle text not null unique,                       -- subdomain: handle.ourplatform.com
  currency char(3) not null default 'USD',
  country char(2) not null,
  status text not null default 'active' check (status in ('active','paused','under_review','suspended','closed')),
  status_reason text,                                -- always filled when not active: we never suspend silently
  status_changed_at timestamptz,
  stripe_account_id text unique,                     -- Stripe Connect account
  verified_at timestamptz,                           -- verified-store badge
  plan text not null default 'starter',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table shop_members (
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','staff')),
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create index on shop_members (user_id);

create table domains (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  hostname text not null unique,
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index on domains (shop_id);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  provider text not null check (provider in ('cj','aliexpress','manual')),
  credentials_ref text,                              -- pointer to a secret in Vault, never the secret itself
  status text not null default 'connected' check (status in ('connected','error','disconnected')),
  created_at timestamptz not null default now()
);
create index on suppliers (shop_id);

create table products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  title text not null,
  handle text not null,
  description_html text not null default '',
  status text not null default 'draft' check (status in ('draft','active','archived')),
  seo_title text, seo_description text,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_product_ref text,                         -- the supplier's product id
  ai_generated boolean not null default false,       -- listing written by the agent, shown to merchant
  search tsvector generated always as (to_tsvector('simple', title || ' ' || coalesce(description_html,''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, handle)
);
create index on products (shop_id, status);
create index on products using gin (search);

create table product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  url text not null, alt text, position int not null default 0
);
create index on product_media (product_id, position);

create table variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  title text not null default 'Default',
  options jsonb not null default '{}',               -- {"Color":"Red","Size":"M"}
  sku text,
  price_minor bigint not null check (price_minor >= 0),
  compare_at_minor bigint,
  cost_minor bigint,                                 -- supplier cost, for margin
  supplier_variant_ref text,
  stock int,                                         -- synced from supplier; null = untracked
  stock_synced_at timestamptz,
  ship_days_min int, ship_days_max int,              -- honest delivery estimate on the product page
  position int not null default 0
);
create index on variants (product_id);

create table collections (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  title text not null, handle text not null,
  rules jsonb,                                       -- null = manual
  unique (shop_id, handle)
);
create table collection_products (
  collection_id uuid not null references collections(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  position int not null default 0,
  primary key (collection_id, product_id)
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  email text not null, name text, phone text,
  accepts_marketing boolean not null default false,
  created_at timestamptz not null default now(),
  unique (shop_id, email)
);

create table shipping_rates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null,
  countries char(2)[] not null,
  price_minor bigint not null,
  free_over_minor bigint
);
create index on shipping_rates (shop_id);

create table discounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  code text not null,
  kind text not null check (kind in ('percent','fixed','free_shipping')),
  value int not null,
  starts_at timestamptz, ends_at timestamptz, usage_limit int, used int not null default 0,
  unique (shop_id, code)
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete restrict,
  number int not null,
  customer_id uuid references customers(id) on delete set null,
  email text not null,
  shipping_address jsonb not null,
  currency char(3) not null,
  subtotal_minor bigint not null, shipping_minor bigint not null, tax_minor bigint not null,
  discount_minor bigint not null default 0, total_minor bigint not null,
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','partially_refunded','refunded','failed')),
  fulfillment_status text not null default 'unfulfilled' check (fulfillment_status in ('unfulfilled','sent_to_supplier','partially_shipped','shipped','delivered','problem')),
  stripe_payment_intent_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, number)
);
create index on orders (shop_id, created_at desc);
create index on orders (shop_id, fulfillment_status);

create table order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  variant_id uuid references variants(id) on delete set null,
  title text not null, quantity int not null check (quantity > 0),
  unit_price_minor bigint not null, unit_cost_minor bigint
);
create index on order_lines (order_id);

create table fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_order_ref text,
  status text not null default 'pending' check (status in ('pending','placed','shipped','delivered','failed','cancelled')),
  failure_reason text,
  carrier text, tracking_number text, tracking_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on fulfillments (order_id);
create index on fulfillments (status) where status in ('pending','placed','shipped');

create table refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  reason text, stripe_refund_id text unique,
  created_at timestamptz not null default now()
);

-- Mirror of Stripe payouts and account requirements, so the merchant sees status, reason and what to send.
create table payouts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  stripe_payout_id text unique,
  amount_minor bigint not null, currency char(3) not null,
  status text not null check (status in ('pending','in_transit','paid','failed','canceled','on_hold')),
  arrival_date date,
  hold_reason text,                                  -- plain-language reason shown to the merchant
  created_at timestamptz not null default now()
);
create index on payouts (shop_id, created_at desc);

create table account_requirements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  requirement text not null,                         -- e.g. 'identity_document'
  explanation text not null,
  due_by timestamptz,
  resolved_at timestamptz
);
create index on account_requirements (shop_id) where resolved_at is null;

create table themes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  template text not null default 'base',             -- React theme package name
  settings jsonb not null default '{}',              -- colors, fonts, logo
  sections jsonb not null default '{}',              -- per page: ordered sections and their settings
  is_published boolean not null default false,
  updated_at timestamptz not null default now()
);
create index on themes (shop_id);

create table pages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  title text not null, handle text not null, body_html text not null default '',
  unique (shop_id, handle)
);

-- Support: AI agent first, human on request. Every agent action is logged and reversible where possible.
create table conversations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  kind text not null check (kind in ('merchant_support','buyer_support')),
  customer_id uuid references customers(id) on delete set null,
  status text not null default 'open' check (status in ('open','waiting_human','resolved')),
  escalated_at timestamptz,
  created_at timestamptz not null default now()
);
create index on conversations (shop_id, status);
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  author text not null check (author in ('merchant','buyer','agent','staff')),
  body text not null,
  created_at timestamptz not null default now()
);
create index on messages (conversation_id, created_at);
create table agent_actions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  agent text not null,                               -- 'support','listing','fulfilment'
  action text not null,                              -- 'update_product','swap_supplier','refund_order'...
  input jsonb not null, result jsonb,
  needs_approval boolean not null default true,
  approved_by uuid references auth.users(id),
  status text not null default 'proposed' check (status in ('proposed','approved','done','rejected','failed')),
  created_at timestamptz not null default now()
);
create index on agent_actions (shop_id, status);

create table webhook_events (                        -- idempotency: Stripe and suppliers retry
  id text primary key,                               -- provider event id
  provider text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table exports (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','ready','failed')),
  file_url text, created_at timestamptz not null default now()
);

-- RLS: member-of-shop rule, applied to every shop-owned table.
create or replace function is_member(s uuid) returns boolean language sql stable security definer as
$$ select exists (select 1 from shop_members m where m.shop_id = s and m.user_id = auth.uid()) $$;

do $$ declare t text; begin
  foreach t in array array['domains','suppliers','products','collections','customers','shipping_rates','discounts',
    'orders','payouts','account_requirements','themes','pages','conversations','agent_actions','exports'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy member_all on %I for all using (is_member(shop_id)) with check (is_member(shop_id))', t);
  end loop; end $$;
alter table shops enable row level security;
create policy member_read on shops for select using (is_member(id));
alter table shop_members enable row level security;
create policy self_read on shop_members for select using (user_id = auth.uid());
-- Child tables (variants, product_media, order_lines, fulfillments, refunds, messages, collection_products)
-- get policies that join to their parent's shop_id; storefront reads go through server code with the service role.

-- v2 additions
create table carts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  email text, lines jsonb not null default '[]',
  recovered_order_id uuid references orders(id) on delete set null,
  reminder_count int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on carts (shop_id, updated_at) where recovered_order_id is null;

create table reviews (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  order_id uuid references orders(id) on delete set null,       -- verified purchase
  rating int not null check (rating between 1 and 5),
  body text, photos text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','published','hidden')),
  created_at timestamptz not null default now()
);
create index on reviews (product_id, status);

create table push_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  token text primary key,
  platform text not null check (platform in ('ios','android')),
  created_at timestamptz not null default now()
);

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  key_hash text not null unique, scopes text[] not null,
  last_used_at timestamptz, revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table ai_usage (
  shop_id uuid not null references shops(id) on delete cascade,
  month date not null,
  input_tokens bigint not null default 0, output_tokens bigint not null default 0,
  cost_minor bigint not null default 0, budget_minor bigint not null,
  primary key (shop_id, month)
);

do $$ declare t text; begin
  foreach t in array array['carts','reviews','api_keys','ai_usage'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy member_all on %I for all using (is_member(shop_id)) with check (is_member(shop_id))', t);
  end loop; end $$;
alter table push_tokens enable row level security;
create policy own_tokens on push_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());
