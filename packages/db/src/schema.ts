// Milestone 1 to 11 tables. Full target schema from the plan: ../schema-target.sql.
// Money is integer minor units plus a currency. Times are timestamptz.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  customType,
  date,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  char,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: "number" });

// Development auth. In production this is replaced by Supabase Auth (auth.users).
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  // Push notification kinds this person turned off in the app (see PUSH_KINDS).
  pushOff: jsonb("push_off").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const shops = pgTable(
  "shops",
  {
    id: id(),
    name: text("name").notNull(),
    handle: text("handle").notNull().unique(),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    country: char("country", { length: 2 }).notNull(),
    status: text("status", { enum: ["active", "paused", "under_review", "suspended", "closed"] })
      .notNull()
      .default("active"),
    statusReason: text("status_reason"),
    paymentsAccountId: text("payments_account_id").unique(),
    // Payout account status, mirrored from the payment provider (Stripe Connect).
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    plan: text("plan", { enum: ["free", "starter", "growth", "scale"] }).notNull().default("free"),
    billingCustomerId: text("billing_customer_id").unique(),
    billingSubscriptionId: text("billing_subscription_id").unique(),
    // UK and EU buyers expect prices with VAT included; US and Canadian prices show tax on top.
    pricesIncludeTax: boolean("prices_include_tax").notNull().default(false),
    // Set while the store meets the verified-store checklist; shown as a badge on the storefront.
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // AI settings. Budget in minor units of USD per calendar month; null means the plan's default.
    aiBudgetMinor: integer("ai_budget_minor"),
    // Kinds of buyer question the support agent may answer without the merchant checking first.
    aiAutoReplyTopics: jsonb("ai_auto_reply_topics").$type<string[]>().notNull().default([]),
    // Let the margin agent pause a product that loses money without asking first.
    aiAutoPause: boolean("ai_auto_pause").notNull().default(false),
    // Remind buyers who started checkout but didn't pay (one email, an hour later).
    abandonedCartEmails: boolean("abandoned_cart_emails").notNull().default(true),
    // Show new reviews straight away instead of waiting for the merchant.
    reviewsAutoPublish: boolean("reviews_auto_publish").notNull().default(false),
    // Extra currencies buyers can shop in, converted from the store's own currency at today's rate.
    presentmentCurrencies: jsonb("presentment_currencies").$type<string[]>().notNull().default([]),
    // Round converted prices up to end in .99 (shipping and tax are never rounded).
    roundConvertedPrices: boolean("round_converted_prices").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("shops_handle_format", sql`${t.handle} ~ '^[a-z0-9](-?[a-z0-9])*$'`),
    check("shops_reason_when_not_active", sql`${t.status} = 'active' or ${t.statusReason} is not null`),
  ],
);

export const shopMembers = pgTable(
  "shop_members",
  {
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "staff"] }).notNull().default("owner"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.userId] }), index("shop_members_user_idx").on(t.userId)],
);

// A supplier connection for one store. Credentials live in a secret store; only a pointer is kept here.
export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["fake", "cj"] }).notNull(),
    credentialsRef: text("credentials_ref"),
    status: text("status", { enum: ["connected", "error", "disconnected"] }).notNull().default("connected"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppliers_shop_provider_uq").on(t.shopId, t.provider)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    descriptionHtml: text("description_html").notNull().default(""),
    imageUrl: text("image_url"),
    status: text("status", { enum: ["draft", "active", "archived"] }).notNull().default("draft"),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    supplierProductRef: text("supplier_product_ref"),
    sourceUrl: text("source_url"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    // Suggested next to this product and in the cart ("Goes well with").
    upsellProductId: uuid("upsell_product_id").references((): AnyPgColumn => products.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_shop_handle_uq").on(t.shopId, t.handle),
    index("products_shop_status_idx").on(t.shopId, t.status),
  ],
);

export const variants = pgTable(
  "variants",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Default"),
    options: jsonb("options").$type<Record<string, string>>().notNull().default({}),
    sku: text("sku"),
    supplierVariantRef: text("supplier_variant_ref"),
    priceMinor: money("price_minor").notNull(),
    compareAtMinor: money("compare_at_minor"),
    costMinor: money("cost_minor"),
    stock: integer("stock"),
    shipDaysMin: integer("ship_days_min"),
    shipDaysMax: integer("ship_days_max"),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("variants_product_idx").on(t.productId), check("variants_price_nonneg", sql`${t.priceMinor} >= 0`)],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    // Set when the buyer signs in to their account on the store.
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("customers_shop_email_uq").on(t.shopId, t.email)],
);

/**
 * What the buyer saw and paid when they shopped in another currency. The order's own amounts stay
 * in the store's currency; these are for the buyer and the card charge.
 */
export type Presentment = {
  currency: string;
  /** Buyer currency units per store currency unit, fixed at checkout. */
  rate: number;
  /** Each item's unit price as shown to the buyer, by variant id. */
  units: Record<string, number>;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
};

export type TaxBreakdownLine = { jurisdiction: string; label: string; rateBps: number; amountMinor: number };

export type Address = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
};

export const orders = pgTable(
  "orders",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "restrict" }),
    number: integer("number").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    shippingAddress: jsonb("shipping_address").$type<Address>().notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    subtotalMinor: money("subtotal_minor").notNull(),
    shippingMinor: money("shipping_minor").notNull(),
    // Taken off the subtotal by a discount code. A free-shipping code sets shipping to 0 instead.
    discountMinor: money("discount_minor").notNull().default(0),
    discountId: uuid("discount_id"),
    discountCode: text("discount_code"),
    taxMinor: money("tax_minor").notNull(),
    totalMinor: money("total_minor").notNull(),
    paymentStatus: text("payment_status", {
      enum: ["pending", "paid", "partially_refunded", "refunded", "failed"],
    })
      .notNull()
      .default("pending"),
    fulfillmentStatus: text("fulfillment_status", {
      enum: ["unfulfilled", "sent_to_supplier", "partially_shipped", "shipped", "delivered", "problem"],
    })
      .notNull()
      .default("unfulfilled"),
    paymentIntentId: text("payment_intent_id").unique(),
    // Our sales fee (free plan only) and the estimated card processing fee, fixed at checkout.
    platformFeeMinor: money("platform_fee_minor").notNull().default(0),
    processingFeeMinor: money("processing_fee_minor").notNull().default(0),
    refundedMinor: money("refunded_minor").notNull().default(0),
    // When prices include tax, tax_minor is the part of the total that is tax; otherwise it's added on top.
    taxIncluded: boolean("tax_included").notNull().default(false),
    taxBreakdown: jsonb("tax_breakdown").$type<TaxBreakdownLine[]>().notNull().default([]),
    taxCalculationId: text("tax_calculation_id"),
    presentment: jsonb("presentment").$type<Presentment>(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_shop_number_uq").on(t.shopId, t.number),
    index("orders_shop_created_idx").on(t.shopId, t.createdAt),
    check(
      "orders_total_matches",
      sql`${t.totalMinor} = ${t.subtotalMinor} - ${t.discountMinor} + ${t.shippingMinor} + case when ${t.taxIncluded} then 0 else ${t.taxMinor} end`,
    ),
    check("orders_discount_within_subtotal", sql`${t.discountMinor} >= 0 and ${t.discountMinor} <= ${t.subtotalMinor}`),
    index("orders_discount_idx").on(t.discountId),
    check("orders_refund_within_total", sql`${t.refundedMinor} >= 0 and ${t.refundedMinor} <= ${t.totalMinor}`),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => variants.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: money("unit_price_minor").notNull(),
    unitCostMinor: money("unit_cost_minor"),
  },
  (t) => [index("order_lines_order_idx").on(t.orderId), check("order_lines_qty_pos", sql`${t.quantity} > 0`)],
);

// Idempotency for incoming webhooks: providers retry, so each event id is processed once.
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

// One supplier order per supplier per customer order. The row id is sent to the supplier as the
// order reference, so a retry after a timeout can't create a second supplier order.
export const fulfillments = pgTable(
  "fulfillments",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    // Null for a parcel the merchant sent themselves.
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["pending", "placing", "placed", "shipped", "delivered", "failed", "cancelled"] })
      .notNull()
      .default("pending"),
    supplierOrderRef: text("supplier_order_ref"),
    problemCode: text("problem_code"),
    problemMessage: text("problem_message"),
    attempts: integer("attempts").notNull().default(0),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    placedAt: timestamp("placed_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("fulfillments_order_supplier_uq").on(t.orderId, t.supplierId),
    index("fulfillments_open_idx").on(t.status).where(sql`${t.status} in ('placed', 'shipped')`),
    check("fulfillments_problem_when_failed", sql`${t.status} <> 'failed' or ${t.problemMessage} is not null`),
  ],
);

// Outgoing email log. Each (order, kind) is sent at most once.
export const emails = pgTable(
  "emails",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["order_confirmation", "shipping_update", "delivered", "refund", "support_reply", "abandoned_cart"] }).notNull(),
    // Tells apart emails of a kind that can repeat (one per refund). Empty for once-only kinds.
    ref: text("ref").notNull().default(""),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    status: text("status", { enum: ["queued", "sent", "failed"] }).notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("emails_order_kind_ref_uq").on(t.orderId, t.kind, t.ref), index("emails_shop_created_idx").on(t.shopId, t.createdAt)],
);

// One theme per shop. The editor writes `draft`; publishing copies it to `published`.
// The document shape is validated in @sf/core (themes.ts), so it stays a plain jsonb here.
export const themes = pgTable("themes", {
  id: id(),
  shopId: uuid("shop_id").notNull().unique().references(() => shops.id, { onDelete: "cascade" }),
  template: text("template").notNull().default("base"),
  draft: jsonb("draft").$type<Record<string, unknown>>().notNull(),
  published: jsonb("published").$type<Record<string, unknown>>().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

export const collections = pgTable(
  "collections",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("collections_shop_handle_uq").on(t.shopId, t.handle)],
);

export const collectionProducts = pgTable(
  "collection_products",
  {
    collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.productId] }), index("collection_products_product_idx").on(t.productId)],
);

// Plain-text pages such as About, Shipping and Returns. Shown at /pages/<handle>.
export const pages = pgTable(
  "pages",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    body: text("body").notNull().default(""),
    seoDescription: text("seo_description"),
    published: boolean("published").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("pages_shop_handle_uq").on(t.shopId, t.handle)],
);

// Domains a merchant already owns, pointed at us. Only verified domains serve the store.
export const domains = pgTable(
  "domains",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull().unique(),
    isPrimary: boolean("is_primary").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("domains_shop_idx").on(t.shopId),
    uniqueIndex("domains_one_primary_uq").on(t.shopId).where(sql`${t.isPrimary}`),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
    amountMinor: money("amount_minor").notNull(),
    platformFeeRefundedMinor: money("platform_fee_refunded_minor").notNull().default(0),
    taxRefundedMinor: money("tax_refunded_minor").notNull().default(0),
    // In the buyer's currency, when they paid in another one.
    presentmentAmountMinor: money("presentment_amount_minor"),
    reason: text("reason"),
    providerRefundId: text("provider_refund_id").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("refunds_order_idx").on(t.orderId), check("refunds_amount_pos", sql`${t.amountMinor} > 0`)],
);

// Mirror of the payment provider's payouts, so the Money page shows status and arrival dates.
export const payouts = pgTable(
  "payouts",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    providerPayoutId: text("provider_payout_id").unique(),
    amountMinor: money("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: text("status", { enum: ["pending", "in_transit", "paid", "failed", "canceled"] }).notNull(),
    arrivalDate: date("arrival_date", { mode: "string" }),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payouts_shop_created_idx").on(t.shopId, t.createdAt)],
);

// Something the payment provider needs before it keeps paying out: an ID, a proof of address...
// Each row is one card on the Money page with the reason in plain words and what to send.
export const accountRequirements = pgTable(
  "account_requirements",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    kind: text("kind", {
      enum: ["identity_document", "proof_of_address", "bank_account", "business_details", "supplier_invoice", "tracking_info", "review"],
    }).notNull(),
    explanation: text("explanation").notNull(),
    holdsPayouts: boolean("holds_payouts").notNull().default(true),
    dueBy: timestamp("due_by", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("account_requirements_open_uq").on(t.shopId, t.providerKey).where(sql`${t.resolvedAt} is null`),
    index("account_requirements_shop_idx").on(t.shopId),
  ],
);

// Documents a merchant sends for a requirement. Kept in the database for now (5 MB cap);
// moves to object storage with the media library.
export const requirementUploads = pgTable("requirement_uploads", {
  id: id(),
  requirementId: uuid("requirement_id").notNull().references(() => accountRequirements.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  providerFileId: text("provider_file_id"),
  createdAt: createdAt(),
});

// Where a store is registered to collect tax: "GB", "EU" (OSS/IOSS), "CA" (GST/HST) or a US
// state such as "US-TX". Tax is only charged to buyers in a registered place.
export const taxRegistrations = pgTable(
  "tax_registrations",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    jurisdiction: text("jurisdiction").notNull(),
    registrationNumber: text("registration_number"),
    providerRegistrationId: text("provider_registration_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tax_registrations_shop_jurisdiction_uq").on(t.shopId, t.jurisdiction)],
);

// A message from the platform about the store's standing: a warning with a deadline, a pause,
// or a reinstatement. Every pause comes with a reason, what to fix, and a way to appeal.
export const storeNotices = pgTable(
  "store_notices",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["warning", "paused", "reinstated"] }).notNull(),
    reason: text("reason", {
      enum: ["late_shipping", "high_refunds", "chargebacks", "prohibited_product", "misleading_listing", "customer_complaints", "identity", "other"],
    }).notNull(),
    explanation: text("explanation").notNull(),
    whatToDo: text("what_to_do").notNull(),
    dueBy: timestamp("due_by", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("store_notices_shop_idx").on(t.shopId, t.createdAt)],
);

export const appeals = pgTable(
  "appeals",
  {
    id: id(),
    noticeId: uuid("notice_id").notNull().references(() => storeNotices.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    status: text("status", { enum: ["open", "accepted", "rejected"] }).notNull().default("open"),
    response: text("response"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("appeals_status_idx").on(t.status, t.createdAt),
    // One open appeal per notice at a time.
    uniqueIndex("appeals_open_uq").on(t.noticeId).where(sql`${t.status} = 'open'`),
  ],
);

// AI agents. Every run is recorded with its token use and cost, and every tool call it makes is an
// agent action: reads run straight away, changes may wait for the merchant's approval.
export const AGENTS = ["listing", "assistant", "buyer_support", "fulfilment", "margin"] as const;
export type AgentName = (typeof AGENTS)[number];

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    agent: text("agent", { enum: AGENTS }).notNull(),
    trigger: text("trigger", { enum: ["merchant", "buyer", "schedule", "event"] }).notNull(),
    status: text("status", { enum: ["running", "done", "failed", "over_budget"] }).notNull().default("running"),
    model: text("model").notNull(),
    conversationId: uuid("conversation_id"),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    // Millionths of a US dollar, so small runs don't round to zero.
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("agent_runs_shop_created_idx").on(t.shopId, t.createdAt), index("agent_runs_order_idx").on(t.orderId)],
);

export const agentActions = pgTable(
  "agent_actions",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    agent: text("agent", { enum: AGENTS }).notNull(),
    tool: text("tool").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    // What the merchant sees in the approvals list and the activity log.
    summary: text("summary").notNull(),
    status: text("status", { enum: ["done", "pending", "approved", "rejected", "failed", "blocked"] }).notNull(),
    // Why it needs the merchant's OK (pending), or why it was refused (blocked).
    reason: text("reason"),
    result: jsonb("result").$type<unknown>(),
    error: text("error"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("agent_actions_shop_status_idx").on(t.shopId, t.status, t.createdAt)],
);

// A conversation: a buyer asking about an order, the merchant talking to their assistant, or a
// ticket for platform staff.
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["buyer", "assistant", "ticket"] }).notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    email: text("email"),
    subject: text("subject").notNull(),
    // needs_merchant: the agent handed it over. escalated: waiting on platform staff.
    status: text("status", { enum: ["open", "needs_merchant", "escalated", "resolved"] }).notNull().default("open"),
    statusReason: text("status_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("conversations_shop_idx").on(t.shopId, t.kind, t.updatedAt),
    index("conversations_status_idx").on(t.status, t.updatedAt),
    uniqueIndex("conversations_buyer_order_uq").on(t.orderId).where(sql`${t.kind} = 'buyer'`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    author: text("author", { enum: ["merchant", "buyer", "agent", "staff"] }).notNull(),
    body: text("body").notNull(),
    // Agent replies to buyers start as drafts unless the merchant allowed that kind of answer.
    status: text("status", { enum: ["sent", "draft", "discarded"] }).notNull().default("sent"),
    topic: text("topic"),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

// Phones signed in to the app that can receive push notifications (Expo push tokens).
export const pushDevices = pgTable(
  "push_devices",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    platform: text("platform", { enum: ["ios", "android", "web"] }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_devices_user_idx").on(t.userId)],
);

export const PUSH_KINDS = ["new_order", "problem_order", "payout_hold", "margin_alert", "agent_proposal", "escalation_reply"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

// Every push we decided to send, one row per person per event, so an event never notifies twice.
export const pushMessages = pgTable(
  "push_messages",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: PUSH_KINDS }).notNull(),
    ref: text("ref").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url").notNull(),
    // sent: handed to the push service. off: the person turned this kind off.
    status: text("status", { enum: ["pending", "sent", "failed", "off"] }).notNull(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_messages_once_uq").on(t.userId, t.kind, t.ref), index("push_messages_shop_idx").on(t.shopId, t.createdAt)],
);

// Photos merchants upload from the app. Kept in the database until object storage is set up.
export const media = pgTable(
  "media",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("media_shop_idx").on(t.shopId)],
);

// Discount codes buyers type at checkout.
export const discounts = pgTable(
  "discounts",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    kind: text("kind", { enum: ["percent", "amount", "free_shipping"] }).notNull(),
    // Percent (1 to 100) or an amount in minor units. Unused for free shipping.
    value: integer("value").notNull().default(0),
    minSubtotalMinor: money("min_subtotal_minor").notNull().default(0),
    // How many paid orders may use it in total; null means no limit.
    usageLimit: integer("usage_limit"),
    oncePerCustomer: boolean("once_per_customer").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("discounts_shop_code_uq").on(t.shopId, t.code), check("discounts_value_ok", sql`${t.value} >= 0`)],
);

// Product reviews from buyers who received their order. One per order and product.
export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rating: integer("rating").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: ["pending", "published", "hidden"] }).notNull().default("pending"),
    reply: text("reply"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reviews_order_product_uq").on(t.orderId, t.productId),
    index("reviews_product_idx").on(t.productId, t.status),
    check("reviews_rating_range", sql`${t.rating} between 1 and 5`),
  ],
);

// What buyers do on the store, for the funnel. No personal data: a random session id from a cookie.
export const STOREFRONT_EVENTS = ["page_view", "product_view", "add_to_cart", "checkout_start"] as const;
export type StorefrontEventKind = (typeof STOREFRONT_EVENTS)[number];

export const storefrontEvents = pgTable(
  "storefront_events",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    kind: text("kind", { enum: STOREFRONT_EVENTS }).notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    // Where the visitor came from: the referring site's host, or null when direct.
    source: text("source"),
    createdAt: createdAt(),
  },
  (t) => [index("storefront_events_shop_idx").on(t.shopId, t.createdAt), index("storefront_events_product_idx").on(t.productId)],
);

// Keys for the public REST API. Only a hash is stored; the key is shown once when created.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // The first characters, to tell keys apart in the list.
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull().unique(),
    access: text("access", { enum: ["read", "write"] }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("api_keys_shop_idx").on(t.shopId)],
);

export const WEBHOOK_EVENTS = ["order.paid", "order.shipped", "order.delivered", "order.refunded", "product.updated"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// Addresses a store wants told about events, signed with a secret only they and we know.
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: jsonb("events").$type<WebhookEvent[]>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_endpoints_shop_idx").on(t.shopId)],
);

// One row per endpoint per event, retried with growing gaps until it's delivered or we give up.
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event", { enum: WEBHOOK_EVENTS }).notNull(),
    ref: text("ref").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["pending", "delivered", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("webhook_deliveries_once_uq").on(t.endpointId, t.event, t.ref),
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_shop_idx").on(t.shopId, t.createdAt),
  ],
);

// Sign-in attempts, to slow down password guessing. Kept for a day.
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: id(),
    email: text("email").notNull(),
    ok: boolean("ok").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("auth_attempts_email_idx").on(t.email, t.createdAt)],
);

// One-time links to set a new password. Only a hash of the token is kept.
export const passwordResets = pgTable(
  "password_resets",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("password_resets_user_idx").on(t.userId)],
);

// Milestone 9: inviting people to help run a store. The invite link is emailed; only its hash is kept.
export const shopInvites = pgTable(
  "shop_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "staff"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("shop_invites_shop_idx").on(t.shopId, t.email)],
);

// Buyer accounts: shoppers sign in to one store with a code emailed to them (no password).
export const buyerCodes = pgTable(
  "buyer_codes",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("buyer_codes_shop_email_idx").on(t.shopId, t.email, t.createdAt)],
);

export const buyerSessions = pgTable(
  "buyer_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("buyer_sessions_customer_idx").on(t.customerId)],
);
