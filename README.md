# Storefront (working name)

A store platform for dropshippers: web admin, fast storefronts, checkout with built-in supplier
fulfilment, and an iOS and Android app. "Storefront" is a placeholder; the name lives in
`NEXT_PUBLIC_BRAND_NAME` and `apps/mobile/app.json`.

Plan: `docs/plan.md`. Target database: `packages/db/schema-target.sql`.

## Layout

| path | what |
| --- | --- |
| `apps/web` | Next.js: admin at `/admin`, storefronts at `<handle>.<root domain>` (or `/s/<handle>`), checkout, webhooks |
| `apps/mobile` | Expo app (Expo Router), five tabs |
| `packages/db` | Drizzle schema and migrations. PGlite locally, Postgres (Supabase) in staging and production |
| `packages/core` | Business logic with tests: auth, stores, products, cart pricing, checkout, payment webhooks, supplier import, order routing, tracking, emails, themes, collections, pages, custom domains, AI agents (`src/ai`) |

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000, no accounts or keys needed
pnpm test           # core unit and integration tests
pnpm --filter @sf/web build && EXPO_PUBLIC_API_URL=http://localhost:3100 pnpm --filter @sf/mobile export:web && pnpm e2e   # end-to-end: web on desktop and phone, plus the app
pnpm --filter @sf/mobile start            # the app in Expo Go (set EXPO_PUBLIC_API_URL to your computer's address)
```

With no environment variables, the app uses an in-process Postgres stored in `apps/web/.data/`
a fake payment provider with signed webhooks, and a demo supplier (try the links on
Products > Import from supplier), so the whole flow works offline.
See `.env.example` and `docs/accounts.md` for the real services.

## Milestones

- [x] M0 Foundations: monorepo, schema, CI workflow, design tokens
- [x] M1 Vertical slice: sign up, create a store, add a product, buy it with a test payment, see it paid in admin
- [x] M2 Dropshipping: import by link, automatic order routing, tracking sync, problem orders, order emails (CJ adapter awaits a live key)
- [x] M3 Storefront: themes and visual editor (draft and publish), collections, pages, menus, custom domains, search basics
- [x] M4 Money and trust: plans with the free plan's 2% fee, Stripe Connect payouts, Money page with holds, refunds, statements, sales tax and VAT, store notices and appeals, verified badge
- [x] M5 AI agents: assistant chat, buyer support with a merchant inbox, listing writer, order fixer, margin watch, approvals, monthly AI budget, staff escalations
- [x] M6 Mobile app: sign in, Today (numbers, problems, swipe-to-approve), orders with fixes and refunds, import by link with AI listing, price and stock edits, camera photos, Money with document photos, assistant chat, push notifications, offline reading and queued approvals
- [x] M7 Growth basics: discount codes, checkout reminders, reviews, suggestions, analytics, public API and webhooks, store export and import
- [x] M8 Launch prep: public site and pricing calculator, draft legal pages, password reset, sign-in limits, security headers, health check, launch preflight (the go-live itself needs accounts; see `docs/launch.md`)

- [x] After launch, part 1: staff accounts with roles (owner, admin, staff), email invites, and ownership hand-over
- [x] After launch, part 2: buyer accounts (sign in with an emailed code, order history, buy again, saved checkout details) and a Customers page
### How an order moves (M2)

1. Payment webhook marks the order paid. Right after the response, the buyer gets a confirmation email and each supplier's items are placed with that supplier (`routeOrder`). One fulfilment row per supplier, claimed before the call, so retries never double-order.
2. A refusal (out of stock, address, wallet balance) becomes a **problem order** with a plain-language fix: try again, or ship it yourself and add tracking.
3. On a schedule (every 30 minutes on a paid Vercel plan, daily on the free one) `/api/cron/fulfillment` places any paid order that was missed and pulls tracking. The first tracking number emails the buyer; delivery emails again. No tracking 7 days after placing flags the order as late.

### How merchants get paid (M4)

1. **Plans** (`packages/core/src/plans.ts`): Free is $0 a month with 2% of each sale (up to 50 orders a month); Starter $19, Growth $49 and Scale $149 take 0%. The fee is fixed on the order at checkout and taken by Stripe as an application fee, so it never needs collecting later. The Plan page and Money page say when another plan would have cost less for the last 30 days. Paid plans are Stripe Billing subscriptions; `customer.subscription.*` webhooks keep the shop's plan in step.
2. **Payouts.** Each store gets a Stripe Connect Express account. Buyers pay the platform, money goes to the store's account (destination charges) and Stripe pays it out to the merchant's bank. Admin > Money shows what's available, clearing, on the way and paid out, worked out from our own order and refund records and the payouts Stripe reports, plus the last 30 days of sales, fees, supplier costs and profit, and a CSV statement.
3. **Holds.** Anything Stripe asks for (`account.updated` requirements) becomes one card on the Money page saying why, what to send and by when, with an upload for documents (JPG, PNG or PDF up to 5 MB, forwarded to Stripe). In test mode, Money has buttons to simulate a hold and run a payout.
4. **Refunds** from the order page, in full or in part. Our fee comes back in proportion (the last refund returns any rounding cent), the buyer gets an email per refund, and a full refund cancels supplier orders that haven't shipped, or says which ones the supplier wouldn't stop.

5. **Tax** (`packages/core/src/tax.ts`). A store charges tax only where it has added a registration under Admin > Taxes: UK VAT, EU VAT (one OSS/IOSS registration, buyer's country rate), Canada GST/HST, or a US state. UK and EU stores show prices with tax included; US and Canadian stores add it at checkout. The pay page and receipts show the tax line, refunds return tax in proportion, and Taxes lists what's owed per place each quarter. Built-in rates are national and state level; set `STRIPE_TAX=on` to have Stripe Tax calculate on the store's own Stripe account (adds US local rates and records each sale for filing). Our 2% is never taken on tax.
6. **Card form.** With Stripe keys set, the pay page loads Stripe's Payment Element (cards, Apple Pay, Google Pay); Stripe returns the buyer to the order status page and the webhook marks the order paid.

### Trust (M4)

1. **No surprise shutdowns.** Platform staff (emails in `STAFF_EMAILS`) send notices from `/staff`: a warning with a reason, what to do and a deadline (sales continue), then a pause only if a warning for the same reason came first. Illegal products and failed identity checks are the only exceptions. Every notice shows as a banner in the admin and can be appealed from Admin > Trust; staff answer appeals from the same page, and accepting a pause's appeal reopens the store.
2. **Automatic checks** run with the scheduled job: a store shipping late on more than 10% of orders, or refunding more than 10%, gets a warning (never a pause) at most once a month per reason.
3. **Verified badge.** A store that passes every public rule (identity checked by Stripe, 30+ days selling, 10+ tracked shipments, 90% shipped within 7 days, 5% or fewer refunds, a returns page, good standing) shows a badge in its footer linking to `/verified`, which lists the rules with the store's live numbers. It's rechecked daily and drops off as soon as a rule isn't met.

### How a store looks and where it lives (M3)

1. **Theme.** Each store has one theme document (`packages/core/src/theme-doc.ts`): colors, fonts, corners, logo, two menus, search text, and an ordered list of home page sections. The editor at Admin > Theme saves a draft as you type and shows it live in a preview frame; Publish makes it what buyers see. Undo and redo work across every edit. Links in a theme can only be store paths, https or mailto, so nothing a merchant types can run code.
2. **Sections** live in `apps/web/src/theme`. They are plain components, so the same code renders the live store on the server and the preview in the browser. Adding a section type is one schema entry, one form entry and one component.
3. **Collections** are hand-picked and ordered. `/collections/all` always lists every active product.
4. **Pages** (About, Shipping and returns...) are plain text, shown at `/pages/<handle>`.
5. **Addresses.** `src/proxy.ts` maps `<handle>.<root domain>` and any verified custom domain to the store, with clean links (`/cart`, `/products/x`). `/s/<handle>` always works too. Merchants add a domain under Admin > Domains, get the one DNS record to add, and press Check now. With `VERCEL_API_TOKEN` and `VERCEL_PROJECT_ID` set, the domain is attached to the Vercel project (which issues the certificate) and Vercel reports when DNS is right; without them the app checks public DNS itself.
6. **Search basics.** Every store serves `/sitemap.xml` and `/robots.txt`; product pages carry schema.org product data, and every page has a title, description and share preview.

### How the AI agents work (M5)

1. **Five agents** (`packages/core/src/ai/agents.ts`): the **assistant** (Admin > Assistant) answers from the store's real data and can queue setting changes, email resends and tickets to our staff; **buyer support** answers questions buyers ask on their order status page; the **listing writer** ("Write with AI" on a product); the **order fixer** ("Ask AI to sort it out" on a problem order, and on the schedule for orders stuck a day); and **margin watch**, which checks supplier costs daily and suggests price changes.
2. **Approvals.** Each agent only has its own tools (`src/ai/tools.ts`), and each tool says when it runs on its own, waits for the merchant's OK, or is refused. Reads always run. Anything that moves money, changes a live product by more than 10%, changes a setting or writes to a buyer about a problem waits on Admin > Assistant (drafted buyer replies wait in Admin > Inbox, where they can be edited before sending). Prices at or below cost and refunds above what's left are refused outright. Approving re-checks the rules before acting. Every call is logged and shown under Admin > AI settings.
3. **Buyer replies.** Until the merchant ticks a topic ("Where is my order", "Returns"...) under AI settings, replies are drafts. Even then, a reply promising money that isn't copied from the store's own pages waits for approval. A buyer can send 5 questions an hour. Buyer text is passed to the model marked as untrusted data, never as instructions.
4. **Budget.** Each plan includes a monthly AI allowance (Free $1, Starter $5, Growth $20, Scale $50); merchants can set a lower cap. Each run's tokens and cost are recorded, and once the month's budget is spent agents stop until the 1st.
5. **Escalations.** Buyer conversations an agent hands to the platform, and merchant tickets from the assistant, show on `/staff`; a staff reply to a ticket appears in the merchant's assistant chat.
6. **Model.** With `ANTHROPIC_API_KEY` set, agents call Claude (`AI_MODEL`, default `claude-opus-5-5`) with prompt caching. Without it, a rule-based demo brain uses the same tools and rules, so everything works offline. `pnpm --filter @sf/core evals` runs 59 agent checks (guardrails and behaviour) on the demo brain; `evals:live` runs them against the real model (also the manual "AI evals" GitHub Action, which needs an `ANTHROPIC_API_KEY` repo secret) and costs a few dollars.

### How the app works (M6)

1. **API.** The app talks to `/api/app/v1/*` (`apps/web/src/lib/app-api.ts`): the same accounts, sessions and core functions as the web admin, with the session sent as a bearer token and the store picked by `X-Shop-Id`. Nothing the app can do skips a rule the web has.
2. **Screens** (`apps/mobile/app`): Today (sales, what needs you, proposals to approve by tap or swipe, drafted buyer messages you can edit), Orders (open, needs you, all; detail with Ask AI, retry, own tracking and refunds), Products (import by link or pasted link, AI listing, price and stock, put on sale, camera or library photos), Money (balance, last 30 days, payouts, hold cards with a photo of the document), Assistant (chat and budget), and Settings (store switcher, which notifications to get, new-order sound, sign out).
3. **Push notifications** (`packages/core/src/mobile/push.ts`) for new orders, problem orders, payout holds, margin alerts, proposals waiting and replies from our staff. They're found by looking at what changed, sent once per person per event through Expo's push service, never for things that happened before the phone signed in, and phones the service reports as gone are forgotten. Sent after each payment, when the app opens Today, after agent runs, and on the scheduled job.
4. **Offline.** Every screen keeps its last copy and shows it with an offline bar. Approvals and price or stock edits made offline wait in a visible queue and go out when the connection is back; refunds and imports need a connection.
5. **Photos** from the app are stored in the database (`media`, JPG/PNG/WebP up to 5 MB, checked by content) and served from `/api/media/<id>`; move them to object storage before launch.
6. **Tests.** The web build of the app (`export:web`) runs in Playwright on a phone-sized screen against the real API (`e2e/app.spec.ts`), including the import-to-on-sale flow in under 60 seconds. `apps/mobile/.maestro` has the same flows for real devices. Builds and store submission use `apps/mobile/eas.json` once the Expo, Apple and Google accounts exist.
7. **Not done yet:** the share-sheet extension (needs a development build: the app already opens `storefront://import?url=…`), and TestFlight / Play internal testing, which need those accounts.

### Growth basics (M7, part 1)

1. **Discount codes** (`packages/core/src/discounts.ts`, admin Marketing page): percent off, amount off or free shipping, with an optional minimum order, start and end dates, a total use limit and once per buyer. Buyers apply a code in the cart; it's checked again at checkout with their email. Only paid orders count toward limits. The discount is spread over the lines so tax is charged on what the buyer actually pays, and the order keeps the code and amount.
2. **Checkout reminders** (`packages/core/src/growth.ts`): one email about an hour after a checkout is left unpaid, with a link straight back to payment. Skipped if the buyer paid since or was reminded in the last day. The Marketing page shows reminders sent and sales won back; the scheduled job sends them, and test mode has a "Send reminders now" button.
3. **Reviews** (`packages/core/src/reviews.ts`): only buyers whose order has shipped can review, once per product, from their order page (the delivery email links to it). The merchant publishes, hides or replies on the Reviews page, or turns on publishing straight away. Product pages show the stars, the reviews and replies, and add the rating to the search data.
4. **Goes well with**: each product can suggest one other product, shown on its page and in the cart while it's on sale and in stock.

### Platform tools (M7, part 2)

1. **Analytics** (`packages/core/src/analytics.ts`, admin Analytics page): sales by day, orders, average order, visitors and conversion for 7, 30 or 90 days; the funnel from visit to product view, cart, checkout and payment; best sellers with views; and where visitors came from. Visits are counted with a random id in a 30-minute cookie (no personal data) by `components/Track.tsx` posting to `/api/events`; cart and checkout steps are recorded in the store's server actions. Events older than about 13 months are pruned by the scheduled job.
2. **Public REST API** (`apps/web/src/lib/public-api.ts`, `/api/v1/*`): `GET /shop`, `GET /orders` (filters and pages), `GET /orders/:id`, `POST /orders/:id/tracking`, `GET /products`, `GET /products/:id`, `PATCH /products/:id` (status, price, stock). Keys are made on the Developers page, shown once, stored as a hash, read-only or read-and-write, and revocable. 120 requests a minute per key.
3. **Webhooks** (`packages/core/src/webhooks.ts`): `order.paid`, `order.shipped`, `order.delivered`, `order.refunded` and `product.updated`, sent once per address, signed (`X-Storefront-Signature: t=…,v1=HMAC-SHA256`), and retried after 1 min, 5 min, 30 min, 2 h and 12 h. Only public https addresses are allowed, checked again at send time (`WEBHOOKS_ALLOW_PRIVATE=on` for development). The Developers page has a test button, delivery history and retry.
4. **Export and import**: a store file (products, variants, collections, pages, theme and menus, discount codes, settings) that loads into a new, empty store in one step, all or nothing, plus products as CSV. Imported products keep their supplier links so orders still route.

### Launch prep (M8)

1. **Public site** (`apps/web/src/app/(marketing)`): the landing page, pricing with a calculator that picks the cheapest plan for a store's sales and orders, and four legal pages (terms, privacy, acceptable use, merchant agreement). The legal pages are drafts with `[bracketed]` gaps and a "Draft for review" banner until a lawyer has checked them.
2. **Accounts**: "Forgot your password?" emails a one-time link (an hour, at most three an hour, and it signs the person out everywhere). Eight wrong passwords for one email in 15 minutes pause sign-in for that email. With `EMAIL_PREVIEW=on` and no real mailer, emails show at `/dev/mail` instead of being sent.
3. **Hardening**: security headers on every response, no `x-powered-by`, `/api/health` for uptime monitors, friendly 404 and error pages, `robots.txt` and `sitemap.xml` for the platform site.
4. **Preflight**: `pnpm preflight` (or **/staff/launch**) checks the production settings and lists what blocks launch. `docs/launch.md` has the human steps and `docs/store-listings.md` the App Store and Google Play drafts.

### Staff accounts (after launch, part 1)

1. **Roles** (`packages/core/src/team.ts`): the owner can do everything; an admin runs the store day to day but not the plan, payouts, team, API keys or export; staff handle orders (no refunds), buyer messages, products, collections and reviews, and don't see money or sales totals. `can(role, area)` is checked by every admin page and server action (`requireShop("orders")` and so on), by the merchant app's API, by the app's tabs, and by which push notifications each person gets.
2. **Invites**: the owner invites by email from the Team page. The link works for a week, only for that email, and leads through sign-up or sign-in back to "Join". Inviting again replaces the link; invites can be cancelled.
3. **Seats** follow the plan (`teamSeats` in `plans.ts`: Scale includes 15). A plan with fewer seats than the team can't be chosen until people are removed.
4. **Changes**: the owner changes roles, removes people, or hands the store to someone else and stays on as an admin. Anyone else can leave.

### Buyer accounts (after launch, part 2)

1. **Sign-in without a password** (`packages/core/src/buyers.ts`): the shopper enters their email on the store's Account page and gets a six-digit code, valid for ten minutes. Five wrong tries use a code up, and at most five codes go to one email an hour. The session is for that store only (cookie `sf_buyer_<store id>`, 60 days).
2. **Account page** (`/account` on the store): every paid order with that email, its status, a Track link, and **Buy again**, which puts what's still for sale back in the cart and says what was left out. Order pages link to it.
3. **Faster checkout**: signed-in shoppers start checkout with the email, name and address from their last order.
4. **Customers page** in the admin (staff included): orders, spend (hidden from staff), last order and whether they've signed in, with search.

### More currencies (after launch, part 3)

1. **Rates** (`packages/core/src/currency.ts`): the European Central Bank's daily reference rates, fetched at most every six hours, with the last good rates kept if the bank can't be reached. `FX_PROVIDER=static` uses fixed rates for development and tests. No markup.
2. **Currencies page** in the admin (owner and admins): turn on USD, GBP, EUR or CAD alongside the store's own currency, see today's rates and a sample price, and choose whether converted product prices round up to end in .99.
3. **Storefront**: a currency picker in the header. Buyers get their own currency automatically from their country (the `x-vercel-ip-country` header) when the store sells in it; the choice is kept in a cookie (`sf_cur_<store id>`).
4. **Checkout and money**: the buyer is charged exactly the total they saw, in their currency. The order keeps the store's currency for the books (analytics, payouts, fees) and stores the buyer's amounts and rate separately. Receipts, order pages and the buyer's account show the buyer's currency; refunds go back in it at the rate paid, and a full refund returns exactly what's left. The merchant's order page shows "Buyer paid in GBP".

### Email campaigns (after launch, part 4)

1. **Consent first** (`packages/core/src/campaigns.ts`): buyers join a store's list only by ticking "Send me news and offers" at checkout or on their account page. Unticking at a later checkout never withdraws an earlier yes; the account page and the unsubscribe link do.
2. **Campaigns page** in the admin (Marketing area): write a plain-text email with `{first_name}`, one tracked link to a store page, and an audience (all subscribers, buyers, not yet bought, or no order in 90 days). Preview, send a test, then send now or schedule.
3. **Sending**: the audience is fixed when it starts; the scheduled job sends 200 at a time and skips anyone who unsubscribed meanwhile. Every email carries the store's mailing address (required before sending), an unsubscribe link that works without signing in, and one-click unsubscribe headers (RFC 8058). 10,000 emails a month on every plan.
4. **Results**: clicks are counted per person; a click sets a one-week cookie (`sf_cmp_<store id>`) and paid orders in that week are credited to the campaign, shown as orders and sales.

### Your own suppliers (after launch, part 5)

1. **Any supplier, no API** (`packages/core/src/own-suppliers.ts`): on the Suppliers page the merchant adds a wholesaler, warehouse or maker by name and email, then picks them under "Who sends it" on a product. Moving a product off CJ or the demo supplier drops its link there.
2. **Orders by email**: when an order is paid, each own supplier gets one purchase order email (`PO-<order number>`) with its items, SKUs and the shipping address. The buyer's email address is never shared. Products from API suppliers in the same order still go to those suppliers.
3. **The supplier's page** (`/supplier/<token>` on the platform address, no account): lists orders to send and recent ones sent. "Mark shipped" with carrier and tracking number emails the buyer at once; "Can't send this order?" turns it into a problem order the merchant sees, with the supplier's note, and "Try again" emails the order again.
4. **Safety**: the link is a 64-character secret that the merchant can replace at any time; removing a supplier stops its link and sends its products back to "I ship it myself", and is refused while it has orders to send. Unshipped orders are flagged late after 7 days like any supplier's, and a refund emails the supplier not to send it. Own suppliers come along in store export and import.

### More themes (after launch, part 6)

1. **Seven ready-made themes** (`THEME_PRESETS` in `packages/core/src/theme-doc.ts`): Clean, Bold, Warm, Boutique, Market, Studio and Nordic. Each sets colors, fonts, corners, a layout and a starter home page, all free. The editor's Themes tab shows them with a small preview; switching keeps the logo, menus and search settings, and keeps the merchant's sections unless they tick "Also replace my home page sections". Undo works as usual.
2. **Layout options** (Style tab, `settings.layout`): header (menu beside the logo, centered logo with the menu below, or a menu button), product photo shape (square, tall, wide), 3 or 4 products per row, plain or framed product cards, filled or outline buttons. The store shell sets them as data attributes and `globals.css` styles the `sf-grid`, `sf-card` and `sf-media` classes. Themes saved before layouts existed get the defaults.
3. **New sections**: customer quotes, trust badges (six icons) and an email signup. The signup is double opt-in: the buyer gets a "confirm your signup" email and joins the campaign list only after pressing Confirm on the store. Confirm links go out at most once an hour per address, and the form shows the same message to people already on the list. Unconfirmed addresses don't appear on the Customers page.

### Wholesale (after launch, part 7)

1. **Quantity discounts** (`setQuantityBreaks` in `packages/core/src/wholesale.ts`): up to three tiers per product, like "buy 2 or more, save 10%", set on the product's admin page. Different options of one product count together. The product page lists the tiers with their prices and shows a quantity box; the cart shows the full price struck through and the tier that applied. Discount codes still work on top.
2. **Wholesale buyers**: the merchant turns wholesale on in the new Wholesale page with one discount for everything (1–80%) and an optional minimum order. Signed-in buyers apply from their account page with a business name, an optional tax or resale number and a note. The merchant approves or declines (the buyer is emailed either way), removes buyers, or adds one they already know by email. A badge on the Wholesale link counts waiting applications. Staff accounts don't see it.
3. **How prices apply**: `quoteCart` takes the signed-in buyer's email. Approved buyers get the wholesale price instead of quantity discounts, discount codes don't stack on it, and checkout is refused below the minimum (the cart says how much more to add). Orders are marked `wholesale` and show a "Wholesale order" pill. Settings and tiers travel in the store export file.
