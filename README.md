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

### Gift cards (after launch, part 8)

1. **Selling them** (`createGiftCardProduct` in `packages/core/src/gift-cards.ts`): the Gift cards page adds a "Gift card" product with one option per amount (`products.gift_card`). Gift cards never get discounts, quantity discounts, wholesale prices, shipping or tax (tax is charged when they're spent), and our sales fee is taken when they're sold, not again when they're spent. When the order is paid, `onOrderPaid` issues one card per unit and emails the code to the buyer; an order of only gift cards is marked delivered. The scheduled job retries anything that didn't finish.
2. **Giving them**: the merchant sends a gift card to any email, with a note, for store credit or a thank-you. Cards can be turned off or given a new code (the old one stops working). Only a SHA-256 hash and the last 4 characters of each 16-character code are stored.
3. **Spending them**: buyers type the code in the cart's code box, which now takes discount and gift card codes. The card pays as much of the total (tax included) as its balance covers and is charged when the rest is paid; a fully covered order is paid at once with no card form. Gift cards are in the store's currency, so buyers paying in another currency switch back to use one. Refunds go to the card payment first, then back onto the gift card; a full refund of an order that bought gift cards turns those cards off. Codes aren't in the store export file.

### Shipping by country (after launch, part 9)

1. **Zones and rates** (`packages/core/src/shipping.ts`): a zone is a list of countries, or "Everywhere else", with up to 5 rates (name, price, optional "free over" amount, optional delivery days). A country can be in one zone only. Stores that haven't set up zones keep the built-in rate (4.99, free over 50, everywhere), so nothing changes until the merchant opts in. "Set up shipping zones" starts them with their own country (Standard and Express) and International.
2. **Checkout**: the country list is the countries the store ships to, and the buyer picks a rate. The order summary follows the country and rate they choose (rates are priced for the cart on the server, in the buyer's currency). `quoteCart` takes the country and rate; checkout refuses a country no zone covers, and a rate from the wrong zone falls back to the cheapest one there. The cart estimates shipping for the store's own country. The order keeps the rate's name (`orders.shipping_method`), shown on the pay page, the buyer's order page and the admin order page.
3. **Elsewhere**: the support assistant reads the zones when buyers ask about shipping prices, free shipping codes still win, gift cards never pay shipping, and zones travel in the store export file.

### Returns (after launch, part 10)

1. **Asking** (`packages/core/src/returns.ts`): the buyer's order page has "Return something" while the store's return window is open (30 days by default, counted from delivery, else shipping, else payment). They pick how many of each item, a reason, and an optional note. One open request per order; gift cards can't be returned. A window of 0 turns the form off and tells buyers to email the store.
2. **Answering** (Returns in the admin, with a badge for new requests, and a banner on the order): **Approve** emails the store's return instructions (or a message written for that return) and waits for the item; **Refund** refunds the order through the usual refund path; **Give store credit** emails a gift card for the amount; **Decline** needs a reason. The amount starts at what the buyer paid for those items (their share of any discount off, tax on). Every answer emails the buyer and shows on their order page.
3. **Elsewhere**: requests show in the order timeline, and the refund reason on the order says it came from a return.

### Store search (after launch, part 11)

1. **Search** (`packages/core/src/search.ts`): every store header has a search icon that opens `/search`. Words match in any order across the title, the description and option names; plurals and accents don't matter, every word has to match, and title matches rank first. Drafts never show. Result pages are kept out of search engines.
2. **Sort and filter**: search results and collection pages (when they have more than one product) can be sorted by best match or featured, best selling (units on paid orders), price either way, or newest, and filtered by a price range in the buyer's currency and "In stock only". It's a plain GET form, so it works without scripts and every result has a shareable address. Grid prices now start from a product's cheapest option.

### Store blog (after launch, part 12)

1. **Posts** (`packages/core/src/blog.ts`, `blog_posts` table): title, address, plain-text body ("## " subheadings, "• " or "- " bullets, blank lines between paragraphs), optional summary and image, and up to 8 featured products. Drafts stay hidden; publishing keeps the first publish date. Admin: Blog (under Online store), using the same permission as Pages.
2. **AI first drafts**: a sixth agent, the blog writer (`writer`), reads the store's products and saves a draft on the merchant's topic, featuring the products they picked. It only ever saves drafts; it counts against the store's AI budget like the other agents, and the demo model writes a templated post without an API key.
3. **On the store**: `/blog` lists posts newest first with reading time, `/blog/<address>` shows the post with "In this post" products and BlogPosting structured data, `/blog/feed.xml` is an RSS feed, and posts are in the sitemap and the store export file. "Blog" and "Search" are now suggested links in the theme menu editor.

### Payment links (after launch, part 13)

1. **Building the order** (Orders → Create payment link; `packages/core/src/payment-links.ts`): the merchant picks products and quantities, enters the customer's email and address, and can add one of their discount codes and a note. The order goes through the same `startCheckout` as the store, so prices, shipping zones, tax and fees match exactly. It's marked `orders.source = 'payment_link'`.
2. **Paying**: the customer gets "Your order from … is ready to pay" with the note and a link to the store's pay page, which shows the note too. Once paid it's an ordinary order (receipt, supplier, tracking). The order page shows the link with Copy and "Email the link again" (up to 5 sends). Payment links are left out of abandoned-checkout reminders.

### Pricing rules (after launch, part 14)

1. **The rule** (Products → Pricing; `packages/core/src/pricing.ts`, `shops.pricing_rule`): multiply supplier cost (1.05× to 20×) or add a fixed amount, round up to .99, .95, a whole amount or not at all, a lowest price, and optionally a crossed-out "was" price a percentage higher (with a note on consumer law). Stores without a rule keep the old default, 2.5× ending in .99. The page shows sample costs with the price and what the merchant keeps after card and plan fees.
2. **Where it applies**: new imports start at the rule's prices (and its crossed-out price). Existing products whose supplier cost is known can be brought in line: the page lists every option the rule would change, now and new, and "Update N products" applies them all. Options without a known cost are left alone, and gift cards are never repriced.

### Customer profiles (after launch, part 15)

1. **Profiles** (Customers → a name; `packages/core/src/customers.ts`): each buyer's orders, spend and average order (hidden from staff, like other sales numbers), addresses, store credit, returns and whether they get marketing emails. Orders link back to the profile.
2. **Notes and tags**: a private note and up to 10 tags per customer (`customers.note`, `customers.tags`). The list filters by tag.
3. **Privacy requests** (owners and admins; the new `privacy` area): "Download their data" gives a JSON file of everything the store holds about the buyer. "Erase their data" removes their name, email, street address, messages, email history, sign-in codes and campaign history, and shows their reviews as "Verified buyer". Orders stay for the store's sales and tax records with only the amounts, country, region and postcode. Erasing waits until no order is still on its way and no return is open, and the merchant types the buyer's email to confirm.

### Stock sync and back-in-stock alerts (after launch, part 16)

1. **Supplier stock sync** (`packages/core/src/stock.ts`): the scheduled job re-reads each imported product's stock and cost from its supplier once a day, so the store stops selling what the supplier ran out of and margins follow cost changes. A listing the supplier took down sells out. The product page has "Check supplier now" for an instant check (`products.stock_checked_at`).
2. **Stock by hand**: each option has a Stock field (blank means not counted). Products from your own suppliers or added by hand keep what you set; supplier products follow the supplier.
3. **Back-in-stock alerts** (`stock_alerts`): a sold-out option shows "Email me when it's back" on the store. When it has stock again, whether from the daily sync, the merchant's edit, the app or the API, each waiting buyer gets one email. The product page shows how many buyers are waiting for each option. Requests are part of a buyer's data export and are removed when their data is erased.

### Product photos (after launch, part 17)

1. **Galleries** (`packages/core/src/gallery.ts`): each product keeps up to 10 photos in order (`products.images`); the first is the main photo and is also kept in `products.image_url`, which lists, carts, emails and search read. Imports keep every photo the supplier lists, and existing products start with their one photo.
2. **Editing**: the product page has a Photos card to upload a photo (JPG, PNG or WebP up to 5 MB, stored like app uploads) or paste an https address, make one the main photo, move them, and remove them. A photo taken in the phone app becomes the main photo.
3. **Store**: the product page shows the main photo large with thumbnails to switch, and gives every photo to search engines and link previews. The public API, the app API and the store file include the full list.

### Web addresses and redirects (after launch, part 18)

1. **Product web addresses** (`packages/core/src/redirects.ts`): the product page has a Web address card to change a product's address (its handle). The old address keeps working through a redirect, and earlier redirects to it are pointed straight at the new one, so there are no chains.
2. **Redirects page** (Online store → Redirects, owners and admins): paste old links one per line, the old address then where it goes, from a spreadsheet or a previous store's export. Full addresses are trimmed to their path; lines that can't be used (like the cart or checkout) stay in the box with the reason. Each redirect shows its visits and can be removed. Up to 2,000 per store.
3. **On the store**: a redirect is only used when nothing on the store is at that address, so it never hides a real page. Product, collection, page and blog addresses, and any other unknown path, check redirects before showing "not found". Redirects travel in the store file.

### Saved items and price drops (after launch, part 19)

1. **Saving** (`packages/core/src/saved.ts`, `saved_items`): the product page has "Save for later", and the heart in the store header opens the Saved items page. Guests' saves live in a cookie for 90 days and move into their account when they sign in. Up to 50 per buyer. The page marks items that got cheaper since they were saved and items that sold out.
2. **Price-drop emails**: when a saved item's price drops by at least 1%, whether from the merchant's edit, a repricing or the daily job, the buyer gets one email listing everything that got cheaper, at most once a day. Buyers can turn these off on the Saved items page (`customers.price_alerts`). Saved items are part of a buyer's data export and are removed when their data is erased.
3. **Admin**: the product page shows how many buyers saved it, so the merchant knows a price cut will reach them.

### AliExpress as a second supplier (after launch, part 20)

1. **The connection** (`packages/core/src/suppliers/aliexpress.ts`): AliExpress's Open Platform dropshipping APIs, signed with the app secret. It turns on when `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET` and `ALIEXPRESS_ACCESS_TOKEN` are set (see `docs/accounts.md`). It is written from AliExpress's reference and tested with recorded-shape replies, but not yet run against a live account.
2. **Importing**: paste an AliExpress item link (aliexpress.com or aliexpress.us). Each option comes in with its cost, stock and delivery time, so the daily stock sync and back-in-stock emails work for AliExpress products too.
3. **Orders**: a paid order goes to AliExpress with the cheapest delivery option for each item and our reference, and is paid with the authorised account's saved card. AliExpress splits orders by seller, so tracking follows every part and only shows once all of them have shipped. AliExpress doesn't let apps cancel orders, so a cancel tells the merchant to do it in AliExpress.
4. **Admin**: the Suppliers page shows AliExpress next to CJ, and the launch preflight accepts either one as the real supplier.

### Store languages (after launch, part 21)

1. **Languages** (`packages/core/src/languages.ts`): a store can add German, French, Spanish, Italian and Dutch next to English. Each language has its own address (`/de`, `/fr`, …) that search engines list, and buyers switch from the footer.
2. **Fixed text** (`apps/web/src/lib/store-text.ts`): buttons, the product page, cart, checkout and card form come translated in every language.
3. **The merchant's own words**: products, collections, pages, menus and home page text are translated on the new Languages page, by hand or with the new **Translator** AI agent, a batch per press. Anything not yet translated shows in English. When the English changes, the translation is marked out of date until someone checks it.
4. **Store file**: languages and translations travel in the store export and load into a new store.
5. **Not yet translated**: order and account pages, emails, search (it matches the English text), option names and SEO descriptions.

### Bundles (after launch, part 22)

1. **Bundles** (`packages/core/src/bundles.ts`): two to four products sold together for up to 50% off, made on the new Bundles page under Marketing. Each bundle can be turned off without deleting it, and it hides itself while one of its products isn't on sale.
2. **Store**: a bundle shows on each of its products' pages with an option picker per product and one "Add all to cart" button, in every store language.
3. **Pricing**: the cart takes the bundle's percentage off every full set. Each item counts towards one bundle at most, bigger discounts first and cheapest items first. Bundles and discount codes don't combine: the cart uses whichever saves the buyer more and says so. Wholesale buyers keep their own prices.
4. **Orders** show the saving as "Bundle (name)" to the buyer, in admin, in the mobile app and in the public API (`bundle_title`). Bundles travel in the store file.

### Rewards points (after launch, part 23)

1. **Points** (`packages/core/src/rewards.ts`): turned on from the new Rewards page under Marketing. The merchant sets points per 1.00 spent and what 100 points are worth. Buyers earn points when an order is paid, on what they pay for goods (not gift cards bought, and not what a gift card paid). Refunds take points back in proportion. Wholesale orders don't earn points.
2. **Buyers** see what an order will earn in the cart (in every store language), and their points, history and a "Swap for store credit" button on their account page. A swap makes a gift card for the credit, emails the code and puts it straight into their cart. Points come off first, so two presses can't spend them twice.
3. **Merchants** see buyers with points, what all points are worth and the top holders on the Rewards page, and can add or take points with a note on a customer's page. Points are in the customer's data export, and the settings travel in the store file.

### Invoices (after launch, part 24)

1. **Numbers** (`packages/core/src/invoices.ts`): every paid order gets an invoice, and every refund a credit note, in one series per store with no gaps (`NL-0001`, `NL-0002`, …). Numbers are taken under a lock on the store row, so two requests at once never share or skip one. Orders paid before invoices existed get theirs the first time anyone opens them.
2. **Details**: the new Invoices page under Settings holds the registered business name, address, number prefix, next number (to continue a series from another shop; it can only go up) and a footer. Tax numbers come from the Taxes page. Each document copies the seller's details when it's issued, so later changes never rewrite it.
3. **Buyers** get a link in the order confirmation and refund emails, and open invoices and credit notes from their order page, in the currency they paid in. Wholesale orders show the buyer's company and tax ID. "Print or save as PDF" prints only the sheet.
4. **Merchants** open them from the order page, see the latest on the Invoices page, and download the register as CSV for a date range. The details (not the number) travel in the store file.

### Scheduled sales (after launch, part 25)

1. **Sales** (`packages/core/src/sales.ts`): a percentage off everything, one collection or chosen products, from a start time to an optional end, made on the new Sales page under Marketing. Sales start and end by themselves; "End now" stops a running one. Overlapping sales don't add up: a product gets the biggest. Gift cards are never on sale.
2. **The store** shows the sale price with the old price crossed out everywhere products appear (home, collections, search, saved items, product page and bundles), plus "On sale: 25% off until June 1." on the product page in every store language. The storefront data layer (`localProducts`) applies running sales with `withSales`.
3. **The cart** charges the sale price and notes the sale on the line. Quantity, bundle and wholesale discounts come off the sale price.
4. **Saved items**: a sale starting counts as a price drop, so buyers who saved the product get the usual email. Saving during a sale remembers the sale price. Sales that haven't ended travel in the store file.

### Checkout add-ons (after launch, part 26)

1. **Add-ons** (`packages/core/src/addons.ts`): up to three products the merchant offers at checkout, each with an optional discount (up to 50%) and a one-line pitch, set on the new Checkout add-ons page under Marketing. The page shows how many paid orders bought each one and what it brought in.
2. **At checkout** the buyer sees the first live add-on that isn't already in their cart, priced in their currency, with a picker for its options. "Add for $11.99" adds it in place: the page re-renders and what the buyer typed stays.
3. **Pricing** (`quoteCart`): the add-on price holds when it's bought with something else, comes off any sale price, replaces quantity discounts on that line, and doesn't apply to wholesale buyers. Order lines record the add-on (`order_lines.addon_id`), and add-ons travel in the store file.

### Product feeds (after launch, part 27)

1. **Feeds** (`packages/core/src/feeds.ts`): every option of every product on sale, as a Google Merchant Center feed (`/feeds/google.xml`, RSS with `g:` tags) and a Meta catalog feed (`/feeds/meta.csv`). Each option is one item grouped by product, with its regular price, any running sale as the sale price with its dates, stock, photos, colour and size from the option names, and the description as plain text. Gift cards aren't listed.
2. **Languages**: `?lang=de` gives the feed in a store language, with translated titles and links into that language's store.
3. **Sales channels** (new page under Marketing): the feed links for each channel and language with a Copy button, the steps to paste them into Merchant Center and Commerce Manager, and a "To fix" list of what kept a product out (no photo, no price) or may get it rejected (no description, a title over 150 characters).

### Product questions (after launch, part 28)

1. **Questions** (`packages/core/src/questions.ts`): shoppers ask about a product in a "Questions" section on its page, in every store language (up to 5 a day per email). The merchant answers on the new Questions page (with a count in the menu, for anyone who can manage reviews), choosing whether the answer also shows on the product page. The shopper gets the first answer by email; later changes don't email again.
2. **AI drafts**: "Draft with AI" asks a new agent, the question answerer, for an answer from the listing (options, prices, stock, delivery time), earlier answers and the store's policies. It only saves a draft; nothing reaches the shopper until the merchant sends it. What the listing doesn't say is marked "[Check: …]" instead of guessed.
3. **Privacy**: shoppers' emails never show on the store. A customer's data export lists their questions; erasing them deletes unanswered ones and shows answered ones as "A shopper".

### Free-shipping goal (after launch, part 29)

1. **In the cart**, a bar shows how far the buyer is from free shipping ("You're $36.01 away from free shipping.") and fills up as they add items, then says when they've got it. It's shown in the buyer's currency and every store language.
2. **Which threshold** (`quoteCart`'s `freeShipping`): the lowest "free over" amount among the paid rates in the buyer's zone. The cart estimates shipping for the country the hosting platform says the buyer is in (`countryHint`), when the store ships there, else for the store's own country. No bar when a rate is free anyway, when a free-shipping code is applied, or for wholesale buyers.

### Gift orders (after launch, part 30)

1. **At checkout** the buyer ticks "This order is a gift" and adds who it's from, an optional message and the recipient's email (optional). The order keeps this in `orders.gift`; orders of gift cards only don't take it.
2. **Emails** (`packages/core/src/fulfillment.ts`): the buyer's confirmation says it's a gift and repeats the message. When tracking comes in, the recipient gets a "gift_shipped" email ("Ada sent you a gift from …") with the message and tracking, and no prices or order link. Without a recipient email, nothing extra is sent.
3. **Order pages**: the merchant's order page shows a Gift section (from, to, message) and the "Gift heads-up" email in the timeline; the buyer's order page shows "A gift for …". A customer's data export includes the gift details, and erasing them removes them.

### Welcome offer (after launch, part 31)

1. **Setting it up** (Marketing page, "Welcome offer"): the merchant turns it on and picks the percentage (5 to 50%), an optional minimum order and how many days the code lasts (7 to 90). The page shows how many codes went out, how many were used and the sales they brought. Codes already sent keep working if it's turned off.
2. **For shoppers** (`packages/core/src/welcome.ts`): the home page email signup says "Sign up and get 15% off your first order." in the store's language. When the shopper confirms their signup (`confirmSignup`), they get an email with a code of their own (`WELCOME-` and six characters), which works once, only at checkout with that email, until it expires. Each address gets one code ever, and people who have already paid for an order get none.
3. **Elsewhere**: personal codes stay off the discount codes list and out of the store file (the offer's settings travel in it). A customer's data export lists their codes, and erasing them turns their codes off.

### Size charts (after launch, part 32)

1. **Size charts** (`packages/core/src/size-charts.ts`, new Size charts page under Products): a table with a size column and up to seven measurement columns, in centimetres or inches, with a note such as how to measure. The merchant edits it in place (add or remove sizes and columns) and attaches it to products or whole collections. A product's own chart wins over a collection's.
2. **On the product page** a "Size chart" button opens the table in a dialog. Buyers switch between centimetres and inches; every number in a measurement cell converts ("86-91" cm is "33.75-35.75" in), and the size column never does. The button and labels are in every store language.
3. **AI drafts**: "Draft with AI" asks a new agent, the size chart drafter, to lay out the measurements the supplier listed in the description ("S: Bust 86cm Length 62cm"). It never invents numbers: sizes without measurements get empty cells and a "[Check: …]" note. Drafts are hidden until the merchant ticks "Show on the store". Charts travel in the store file.

### Track your order (after launch, part 33)

1. **For buyers without an account**: every store's footer has "Track your order". The buyer enters their email and order number, and we email that address the link to the order's status page (`packages/core/src/order-lookup.ts`), where they see where it is and can track it.
2. **Privacy**: the page gives the same answer whether or not an order matched, so it can't be used to check who bought what. Only paid orders get a link, and each order gets at most one link email per ten minutes. The email shows in the order's email list in the admin as "Order link (Track your order)". The page and email texts are in every store language (the email itself is in English, like the other order emails).

### Recently viewed (after launch, part 34)

1. **On product pages and in the cart**, a "Recently viewed" row shows the last products the shopper opened, newest first (up to six), with photo and price in their currency and language. A product page never lists itself, and the cart leaves out what's already in it. Sold-out products show as sold out; drafts, archived products and gift cards never show.
2. **Privacy**: the list lives in a cookie on the shopper's device (`sf_rv_<store>`, product ids only, up to twelve, kept 60 days), set by a small script on the product page (`RememberView`). Nothing is stored on the server. `packages/core/src/recently-viewed.ts` turns the ids into products.

### Order risk check (after launch, part 35)

1. **Every paid order is checked** for signs of a stolen card, using only what the store already knows: a throwaway email service, two or more declined payments with the same email in a day, three or more orders from one email within an hour, an address that three or more differently named buyers shipped to this month (often a parcel forwarder), a total far above the store's average (or a first order over 500), and 10 or more of one item (wholesale orders excepted). Each sign adds points: 0 is low risk, 1–2 medium, 3 or more high. The reasons are saved on the order in plain words (`packages/core/src/risk.ts`).
2. **Risky orders wait for the merchant.** By default high-risk orders are held; on Orders → On hold the merchant can hold medium ones too, or never hold. A held order isn't sent to the supplier (the scheduled job skips it as well), so the merchant can refund it before paying for goods they'd lose to a chargeback. The buyer gets their usual confirmation.
3. **Where it shows**: the On hold filter and pill on Orders, a card on the order with the reasons and "It's fine, send it" or "Refund in full", the admin home, the app's Today screen and its "Needs you" list (with the same two buttons on the order), and the new-order notification ("New order #1001 is on hold"). Orders that weren't held show their risk level in the side panel.

### Refer a friend (after launch, part 36)

1. **The merchant turns it on** in Marketing → Refer a friend and sets the friend's percent off (5–50%), the credit for the buyer (1.00–100.00) and an optional minimum order. The page shows friends sent a code, their orders and sales, and the credit given.
2. **Buyers share a link** (`<store>/refer/<code>`) from their order page and account, where they also see how many friends asked for a code and the credit they've earned.
3. **A friend opens the link**, sees "Ada gave you 15% off", and enters their email. The code (`FRIEND-XXXXXX`) is only emailed, never shown, so it reaches the person who owns the address. It works once, only with that email, for 30 days. Nobody gets one twice, the buyer can't refer themselves, and people who already bought from the store get none; the page answers the same either way.
4. **The buyer gets store credit** as a gift card once the friend's order is delivered and not refunded, so the merchant never pays credit on an order that's returned or charged back. The scheduled job sends it, once per friend (`packages/core/src/referrals.ts`).

### Filters (after launch, part 37)

1. **Collection and search pages** now let shoppers narrow products by the options they come in, such as size and colour, next to the existing price, in-stock and sort controls. Each option is a fold-out list of checkboxes with how many products have each value; up to four options show, the ones most products have first, and an option with only one value isn't offered. "Colour" and "Color" count as one. There's also an "On sale" box for products with a compare-at price.
2. **How matching works**: a product matches when one of its variants has every picked option (any of the picked values for each), and that same variant is in stock or on sale when those boxes are ticked. So "Black" and "L" won't show a tee that only comes black in M. The options list stays the same while filtering, so other values can still be picked. Filtered pages are plain addresses (`?opt=Size:Large&sale=1`), so they can be shared (`packages/core/src/search.ts`).
3. **Where options come from**: imports now keep each variant's named options from the supplier (CJ's "Color-Size" pairs, AliExpress SKU properties, the demo supplier's sizes), and the API accepts `options` on variants. Products imported before this have none until re-imported. Renaming a one-option variant in the admin ("Small" to "S") renames the option too.

### Bulk edit (after launch, part 38)

1. **On the Products page** the merchant ticks products (or "Select all") and picks a change: publish, hide (draft) or archive; change prices by a percent, up or down, with optional .99/.95/whole rounding; set a crossed-out "was" price a percent above the price, or remove it; add to or take out of a collection.
2. **Preview first**: "Preview" lists every product and option with its value now and after. Price changes that would sell an option for less than the supplier charges are marked "Below cost" and need a "Sell below cost" tick. Gift cards keep their face values, and a "was" price that would sit at or under a raised price is dropped so it never reads as a fake sale. Buyers who saved a product get the usual price-drop email.
3. **Undo for a week**: each change is listed under "Recent changes" with an Undo button. Undo puts back only what the change set and nobody has edited since, so a price fixed by hand afterwards stays (`packages/core/src/bulk-edit.ts`, table `bulk_edits`).

### Profit report (after launch, part 39)

1. **Admin → Profit** shows the last 7, 30 or 90 days: sales after discounts and refunds, supplier costs, fees, ad spend and profit, then the same for each product, best first. Shipping charged is set against the supplier's shipping and tax isn't counted, as on the Money page. A supplier's cost counts once they accepted the order, even if the buyer was refunded later, because that money is spent; our sales fee comes back with a refund and the card fee doesn't. Gift cards count when they're spent, not when bought (`packages/core/src/profit.ts`).
2. **Ad spend**: the merchant enters what they spent per day and channel (Facebook and Instagram, Google, TikTok, Pinterest, Snapchat, other), for one product or the whole store (table `ad_spend`). Each product shows its ROAS (sales per unit of ad spend) and its break-even ROAS, the point where ads use up all its profit; a product below it shows in red. Spend for the whole store comes off the total.
3. **Money page and app**: "Last 30 days" on the Money page and in the app now ends in "Profit after ads". The app's Money tab has a quick "Today's ad spend" entry and the five products earning the most (or losing the most) after ads.

### Options editor (after launch, part 40)

1. **Products added by hand** can have up to three options, like Size (S, M, L) and Color (Black, White). The merchant types each option's values once, and every combination ("S / Black", "S / White"…) gets its own row with price, "was" price, cost and stock, up to 100 combinations. New combinations start from the first row's price.
2. **Editing keeps what's there**: each option is saved by its id, so removing a value or adding one leaves the other combinations, their stock, past orders and back-in-stock requests untouched. Removing every option goes back to a single price. The values are saved as named options, so collection and search filters (part 37) offer them straight away (`combineOptions` in `packages/core/src/products.ts`).
3. Supplier products keep the supplier's options, since each one is tied to the supplier's listing, and gift cards keep their amounts.

### Option picker (after launch, part 41)

1. **On product pages** with named options (sizes and colours from the supplier or the options editor), shoppers pick each option on its own row ("Size: M", "Color: Black") instead of scrolling a list of every combination. The chosen combination and its price show under the choices (`components/OptionPicker.tsx`).
2. **Stock-aware**: a value with nothing in stock is crossed out and can't be picked. Picking a value that isn't in stock with the other choices moves them to the closest combination that is ("Red" switches Size from S to L when red only comes in L), so Add to cart always adds something available.
3. Products whose options don't line up (older imports without named options) keep the plain list. Option order follows the variant titles, since the database doesn't keep the order of option names.

### Variant photos (after launch, part 42)

1. **A photo per colour**: on a product with options, the merchant picks which of the product's photos each colour (or each option, when there's no colour) shows, under "Photo for each color" on the product page. New combinations added later (a new size) start with their colour's photo (`setVariantPhotos` and `variantPhotoRows` in `packages/core/src/gallery.ts`, `variants.image_url`).
2. **On the store**, picking a colour switches the gallery to its photo, with the option picker and the plain option list alike. The cart shows the picked variant's photo instead of the cover.
3. **From suppliers**: CJ's variant images and AliExpress's SKU images come in with the import. The cover stays first and variant photos are kept within the ten-photo limit. Removing a photo clears it from the options that used it, and store export and import carry each variant's photo.

### Changing an order before it ships (after launch, part 43)

1. **Buyers fix it themselves**: for 12 hours after paying, and only until it ships, the buyer's order page has "Wrong address, or need another size?". They can correct the address (in the same country, since shipping and tax were worked out for it) or switch an item to another size or colour at the same price that's in stock. A new address is risk-checked again unless the merchant already reviewed the order.
2. **Merchants too**: the admin order page has "Change the address or a size" until the order ships.
3. **The supplier gets the new version**: the affected supplier orders are cancelled and placed again with the change. If a supplier won't cancel because it's already packing, nothing changes and the buyer is asked to message the store. Each change is emailed to the buyer and listed on the order's timeline (`editOrder` in `packages/core/src/order-edits.ts`, `orders.edits`).

### Buy X, get Y (after launch, part 44)

1. **A new kind of offer** on the Marketing page: "Buy 2, get 1 free", or the items they get at a percent off, for every product or only the ones ticked. For every X items bought, the next Y are discounted, always the cheapest in the cart (`bxgyDiscount` in `packages/core/src/discounts.ts`).
2. **Automatic by default**: the offer applies without a code, product pages it covers show it, and the cart says when one more item would be free ("Add 1 more and it's free", in the store's language). It can also be a code that buyers type. A bundle that saves more wins, as with codes.
3. Usage limits, dates, minimum order and once per buyer work as for other codes, and store export and import carry the offer.

### Order notes and tags (after launch, part 45)

1. **A note from the buyer**: checkout has "Note for the store (optional)", in the store's language. The note shows on the admin order page (with a reminder that the supplier doesn't see it), as "Has a note" in the order list, on the buyer's order page, in their receipt email, in the app and in the public API (`orders.buyer_note`).
2. **The merchant's own note and tags** on each order ("follow up", "vip"), never shown to the buyer (`updateOrderNotes` and `orderTags` in `packages/core/src/orders.ts`). The order list shows the tags, filters by them, and searches by order number, name or email.
3. Erasing a buyer's data clears both notes, since they're free text and may be about them. The buyer's copy of their data includes their note.

### Backup supplier (after launch, part 46)

1. **A second listing for a product**: on an imported product's page, "Backup supplier" takes the same product's link from another listing or supplier. Its options are matched to the product's by name ("Size: Small"), and the panel shows what each one costs there next to the main supplier's cost (`setBackupSupplier` in `packages/core/src/backups.ts`, `products.backup`).
2. **Orders don't stall**: when the main supplier says it's out of stock or no longer lists the product, the supplier order goes to the backup instead of becoming a problem. The order page says so ("Sent to backup"), the order's cost follows the backup's price, and changing the order redoes it at the backup without also sending it to the main supplier (`placeWithBackup` in `packages/core/src/fulfillment.ts`, `fulfillments.backup_note` and `backup_for_supplier_id`).
3. **The store keeps selling**: the daily stock check adds the backup's stock to the main supplier's, so a product isn't sold out while the backup has it. Store export and import carry the backup. A supplier order mixing items that would end up at different suppliers stays a problem for the merchant, as before.

### After-checkout offer (after launch, part 47)

1. **One more product, one click**: on the Marketing page the merchant picks a product and a percent off (up to 50%). For 15 minutes after paying, the buyer's order page offers it with the exact amount to be charged, tax included, and "Add to my order" charges the card they just used, with no extra shipping (`acceptPostPurchaseOffer` in `packages/core/src/post-purchase.ts`).
2. **Its own order**: the added item becomes a new order linked to the first (`orders.parent_order_id`, source `post_purchase`), with its own receipt, invoice, supplier order and refunds. Both order pages, in the store and the admin, link to each other. A declined card leaves nothing behind, and a second click can't charge twice (one follow-up order per order).
3. **Payments**: the card is kept at checkout only while the offer is on, and only for orders in the store's currency (`saveCard` and `chargeSavedCard` on the payment provider; Stripe uses an off-session charge on the saved card). Buyers who already have the product, or orders paid only by gift card, see no offer. The Marketing page counts how often it was added and what it brought in, and store files carry the setting.

### Collections that fill themselves (after launch, part 48)

1. **Rules instead of picking**: a collection can be "By rules" instead of hand-picked. Conditions are title contains a word, price at most or at least, on sale (has a compare-at price), in stock, added in the last N days, and an option value like "Color is Red". Products must meet every condition or any one, sorted newest, cheapest, dearest or A to Z (`packages/core/src/collection-rules.ts`, `collections.rules`).
2. **Always up to date**: membership is worked out when it's read, from the active products, so a price change, a sell-out or a new import shows at once with nothing to sync. Sales and size charts aimed at the collection, the home page sections and the store page all use the same membership (`collectionMembership` in `packages/core/src/collections.ts`).
3. **Admin**: the editor shows which products match while the merchant types, the collections list marks them "By rules", bulk edit can't add to them, and store files carry the rules.

### Photo reviews (after launch, part 49)

1. **Photos with a review**: buyers can add up to 3 photos (JPG, PNG or WebP, 3 MB each) when they review from their order page. Each file's first bytes are checked, and nothing is stored if the review is turned down (`submitReview` in `packages/core/src/reviews.ts`, `reviews.photo_ids`).
2. **On the product page**: a "Photos from buyers" strip above the reviews links to each photo's review, and each review shows its photos. Photos on hidden or pending reviews don't show.
3. **Admin and privacy**: the Reviews page shows each review's photos with a Remove button that deletes the file. A buyer's data export lists their photos, and erasing a buyer deletes them.

### Replacements for lost or damaged orders (after launch, part 50)

1. **Send it again, free**: from a shipped order's page, "Send a replacement" sends some or all of its items again as a new order at no charge (`sendReplacement` in `packages/core/src/replacements.ts`). It goes to the supplier like any order, so it gets tracking and emails. There's no invoice, and the risk check isn't run again.
2. **From a return**: buyers can now pick "It never arrived" when they report a problem, and the merchant can answer any return with "Send a replacement", with nothing to send back (`decideReturn` action `replace`, status `replaced`).
3. **Linked both ways**: the admin and buyer pages link the original order and its replacements, and the buyer gets an email saying what's coming. Replacements aren't counted as sales in analytics, but their supplier cost counts against profit. They can't be reviewed separately.

### Subscribe and save (after launch, part 51)

1. **Offer on the order page**: with Subscribe and save on (Marketing), for 7 days after paying the buyer's order page offers to send the same items again every 2 weeks, month or 2 months, at the merchant's percent off (up to 30%). Checkout keeps the card for it, as for the after-checkout offer (`subscriptionOfferFor` and `startSubscription` in `packages/core/src/subscriptions.ts`).
2. **Each delivery is an order**: the daily job (`runDueSubscriptions`) emails buyers 3 days before each charge, then places due deliveries as orders with `source` `subscription`. The price is today's price less the percent, plus shipping and tax. They're charged to the saved card and sent to the supplier like any order. A declined card or a sold-out item is tried again in 2 days, and after 3 failures in a row the subscription pauses and the buyer is told. Nothing is charged for a failed try.
3. **Buyer control**: every email links to a private page (`/subscriptions/<token>`) where the buyer can skip the next delivery, change how often, pause, resume or cancel. Signed-in buyers also see their subscriptions on their account page.
4. **Merchant view**: Admin → Subscriptions lists every subscription with its deliveries and sales, and lets the merchant cancel one for a buyer, who gets an email. In test mode, "Send next delivery now" places the next one at once. A buyer whose card stopped working can resume to try again, but can't enter a new card yet.

### Delivery dates (after launch, part 52)

1. **On product pages**: under "Add to cart", buyers see "Arrives Oct 18 – Oct 25 to United States" and how it breaks down ("Ships within 2 days, then 6–10 days in transit"), in the store's language. It's for the visitor's country when the store ships there, using the cheapest rate (`productDelivery` in `packages/core/src/delivery.ts`).
2. **Honest by design**: transit is the slower of the supplier's own estimate (saved on each option at import) and the shipping rate's days, so the store never promises faster than the supplier ships (`transitDays`). With neither, no date is shown.
3. **After paying**: the order page and the confirmation email show the expected delivery, counted from payment with the rate the buyer picked, and from the shipment once it has shipped (`orderDelivery`).
4. **Settings**: Admin → Shipping → Delivery dates turns it on or off and sets processing days (0–14, default 2), with a preview using one of the store's products. Store files carry the setting.

### Disputes (after launch, part 53)

1. **Every chargeback in one place**: when a buyer's bank pulls a payment back (or first asks a question), the payment provider tells us and the dispute appears on the order with its reason, amount and answer-by date (`applyDisputeEvent` in `packages/core/src/disputes.ts`, from `charge.dispute.*` webhooks). Everyone who handles money gets an email and a phone alert once.
2. **Evidence gathered for you**: the order page shows what we'll send (tracking number, delivery, returns policy, messages with the buyer), with what's missing marked, plus a summary of the order. The merchant adds an optional note and presses "Send evidence", or accepts the dispute if it's fair (`disputeEvidence`, `submitDispute`, `acceptDispute`).
3. **Disputes page**: Admin → Disputes lists them, open ones first, with money held, wins and losses, and the 90-day dispute rate. Above 0.75% it warns, since processors can hold payouts at that level. The nav shows how many need an answer.
4. **Counted in profit**: a lost dispute counts like a refund on the profit report, with a $15 dispute fee. In test mode, an order page can simulate a dispute and the bank's decision through the real webhook path.

### Personalised products (after launch, part 54)

1. **Fields on a product**: Admin → Products → a product → Personalisation adds up to 3 text fields, each with a label ("Name to engrave"), a character limit (up to 200) and whether it's required (`setPersonalization` in `packages/core/src/personalization.ts`, `products.personalization`).
2. **On the product page**: buyers fill the fields in above "Add to cart". The same option with different text is its own cart line, and stock counts them together. Text is tidied and cut to each limit on the server. If a required field is empty (say the item came from a bundle or a suggestion), the cart says what to add and checkout won't start.
3. **Everywhere after**: the text is saved on the order line (`order_lines.personalization`) and shows at checkout, on the order page, in the receipt, on the admin order page and in the app. It goes to the supplier with the item: as the item memo on AliExpress, the order remark on CJ, and under the item in an own supplier's purchase order. Replacements and subscriptions keep it, and store files carry the fields.

### Win-back emails (after launch, part 55)

1. **Codes for quiet customers**: with win-back emails on (Admin → Marketing), the daily job emails a personal code to subscribers whose last order was 30, 60, 90 or 180 days ago, at the merchant's percent off (5–50%) for 7–60 days (`sendWinbackEmails` in `packages/core/src/winback.ts`). Codes work once, only with that email, and stay off the merchant's list of codes, like welcome codes.
2. **Polite by design**: only buyers who said yes to emails and haven't unsubscribed get one, with an unsubscribe link and one-click unsubscribe header. Each quiet spell gets one email: another only after they order again (`customers.winback_sent_at`). Anyone whose last order is more than six months past the wait isn't emailed. Free replacements don't count as orders.
3. **Results**: the Marketing page shows how many people are due one now, codes sent, how many came back and the sales they brought. Store files carry the setting.

### Supplier price watch (after launch, part 56)

1. **Rises are noted**: when the daily stock check sees a supplier charge more for an option, it's recorded with the cost and price at the time (`recordCostChange` in `packages/core/src/price-watch.ts`, `cost_changes`). A cost that climbs again before the merchant looks is the same note. Falling costs are left alone.
2. **Told when it matters**: Admin → Price changes shows each rise with the margin before and after. If the margin falls below the merchant's target (20% by default), everyone who manages products gets one email a day listing them (`notifyCostChanges`), and the nav shows how many need a look.
3. **One click**: "Raise to $X" sets the price the pricing rule gives for the new cost (never lower than today's), or "Keep price" closes it. With "Raise prices automatically" on, the store raises it straight away and the email says so. Prices never go down on their own. In test mode, the page can simulate a rise. Store files carry the settings.

### Pre-orders (after launch, part 57)

1. **Keep selling when it's sold out**: Admin → Products → a product → Pre-orders turns them on with a ship-by date (tomorrow to 120 days out) and an optional limit (`setPreorder` in `packages/core/src/preorders.ts`, `products.preorder`). Sold-out options stay buyable until the date passes or the limit is reached; options in stock sell as usual.
2. **Buyers know before they pay**: the product page says "Pre-order: ships by …" and the button reads "Pre-order" when everything is sold out (in all six store languages). The cart, checkout, receipt and order page show the date, and the delivery estimate counts from it.
3. **Orders wait for stock**: a pre-order line is marked on the order (`order_lines.preorder`, `orders.preorder_ships_by`) and isn't sent to the supplier while it's sold out. Once the daily stock check sees it back, the next run places it (`routeStuckOrders`). If the date passes first, everyone who handles orders gets one email (`notifyLatePreorders`), and the admin order page says what it's waiting for. Store files carry the setting.

### Supplier scorecard (after launch, part 58)

1. **How each supplier is doing**: Admin → Suppliers shows, for the last 90 days of orders, how many each supplier took, how many it couldn't, the typical days to ship and to arrive (the middle order's, from when it was placed), and how many orders had a problem it caused: never arrived, damaged, wrong or not as described, or replaced for free (`supplierScorecard` in `packages/core/src/supplier-scores.ts`). A buyer changing their mind doesn't count.
2. **A plain grade**: Good, Watch or Poor, decided by the worst measure (more than 5% or 10% couldn't take, more than 2% or 5% problems, more than 4 or 7 days to ship), and "Too few orders" under 5 (`gradeSupplier`).
3. **What to do**: it lists orders a supplier hasn't shipped a week after they were placed, and for a supplier graded Watch or Poor, how many of its products have no backup supplier to fall back on.

### Orders as a spreadsheet (after launch, part 59)

1. **Download CSV**: Admin → Orders → "Download as a spreadsheet" gives the orders shown (search, tag and "Needs attention" or "On hold" apply), optionally between two dates, oldest first (`ordersCsv` in `packages/core/src/order-export.ts`, route `/admin/orders/export.csv`).
2. **One row per item**: each row has the order's number, dates, buyer, shipping address, statuses and money (subtotal, discount, shipping, tax, total, refunded), then the item, quantity, unit price, whether it was a pre-order and any personalisation, plus tracking, tags and both notes. Cells that a spreadsheet would run as a formula are defused.

### Often bought together (after launch, part 60)

1. **Learned from real orders**: products bought in the same paid order at least twice in the last 180 days are suggested on each other's page under "Often bought together", most often first, up to three (`boughtTogether` in `packages/core/src/growth.ts`). Free replacements and subscription deliveries don't count, and hidden, sold-out and gift card products are left out.
2. **In the cart too**: after the merchant's own "Goes well with" picks, the cart offers what other buyers bought with what's in it, with one-click add, up to three in all. Titles are translated in each store language.

### Search listings (after launch, part 61)

1. **A listing per product**: Admin → Products → a product → Search engine listing sets the title (up to 70 characters) and description (up to 160) that search engines show, with a live preview and character counts (`setProductSeo` in `packages/core/src/seo.ts`, `products.seo_title` and `seo_description`). Empty fields fall back to the product's title and the start of its description. The store page uses them in its main language; translated pages keep their translated title and description.
2. **What needs work**: Admin → Search listings checks every product on sale for supplier filler in the title ("hot sale", "2024 new", words in capitals), titles too long to show in full, nothing useful to show under the title, two products with the same title, and no photo (`seoReport`), with a link to fix each one.
3. **AI fills it in**: "Write with AI" on a product now also writes a search description. Store files carry the listing.

### Purchase limits (after launch, part 62)

1. **Least and most per order**: Admin → Products → a product → Purchase limits sets the fewest and the most a buyer can order at once, counting every option of the product together (`setPurchaseLimit` in `packages/core/src/purchase-limits.ts`, `products.purchase_limit`). The product page shows the limits under a quantity box that follows them.
2. **Most per customer**: for limited drops, a cap across all of a buyer's paid orders, matched by email (`boughtBefore`). It's checked at checkout, and in the cart already when the buyer is signed in. Free replacements don't count, and repeat deliveries of a subscription aren't stopped.
3. **What the buyer sees**: the cart says what to change next to the item, in the store's language, and checkout won't start until it's fixed (`quoteCart` returns `limit` on the item; `startCheckout` refuses it). Store files carry the limits.

### Few left (after launch, part 63)

1. **"Only 3 left"**: product pages say how many are left of the option the buyer is looking at when its stock is at or below the store's number, 5 unless changed (`lowStockLeft` in `packages/core/src/stock.ts`, `shops.low_stock_note`). The count is always the real stock from the supplier sync or what the merchant entered; options without a stock count and sold-out options never show it.
2. **The merchant's choice**: Admin → Products → Few left sets the number from 0 (off) to 50 (`setLowStockNote`). Store files carry it.

### Ad tracking (after launch, part 64)

1. **Meta, TikTok and Google tags**: Admin → Sales channels → Ad tracking takes the Meta pixel ID, TikTok pixel ID and Google tag ID (`setAdPixels` in `packages/core/src/pixels.ts`, `shops.ad_pixels`). Each is checked against the platform's format when saved and again before it reaches a page, since it ends up in a script.
2. **What they hear**: page views, product views, add to cart, checkout started and purchases, with the price, the store's currency and the same option IDs as the product feeds (`components/AdPixels.tsx`, `PixelEvent`). A purchase is reported once, however often the order page is opened; free replacements aren't.
3. **Asked first**: a cookie banner in the buyer's language asks before any tag loads, for every visitor or only those in the EU, EEA, UK and Switzerland (`needsConsent`; a visitor whose country isn't known is asked). Saying no doesn't stop anyone from shopping, and "Cookie settings" at the foot of each page changes the answer. Store files carry the settings.

### Move from Shopify (after launch, part 65)

1. **Bring the products**: Admin → Products → Move from Shopify takes the products file Shopify exports (Products → Export → CSV) and adds every product with its options, prices, compare-at prices, costs, stock, SKUs, photos (and photo per option) and search listing (`importShopifyProducts` in `packages/core/src/shopify-import.ts`).
2. **Same addresses**: each product keeps its Shopify handle, so /products/… links and search results keep working once the domain points here. A handle longer than ours (60 characters) is shortened and the old address redirects to it.
3. **Safe to repeat**: products already in the store are left alone. Everything comes in as a draft unless the merchant ticks the box to keep Shopify's status. Gift cards and rows without a price are listed as not imported, with the reason.
4. **Customers too** (part 66): the same page takes Shopify's customers file (`importShopifyCustomers`). Names, notes and tags come across; customers who agreed to marketing email on Shopify can get campaigns here. Nobody is subscribed who didn't agree, someone who unsubscribed here stays unsubscribed, and a customer already here keeps their name and note (tags are added).

### Store status (after launch, part 67)

1. **Password page before launch**: Admin → Store status → Behind a password (`setStoreClosure` in `packages/core/src/store-closure.ts`, `shops.closure`). Every store page sends visitors without the password to an "Opening soon" page with the merchant's message and opening date, where they can join the store's email list. The right password sets a cookie for 30 days; a new password lets out everyone who had the old one. Order, payment, unsubscribe and signup links from emails still open, and robots.txt keeps search engines out.
2. **Holiday break**: Admin → Store status → On a break. Buyers can look around and fill their cart, but every page says the store is on a break (and when it's back), the cart has no checkout button, and new checkouts are refused (`onHoliday`). Subscription deliveries and after-checkout offers carry on.
3. **Opens by itself**: either can end on a date the merchant sets (`activeClosure`), so nobody has to remember to switch the store back on. The admin shows a banner while the store is closed.

### Product videos (after launch, part 68)

1. **One video per product**: Admin → Products → a product → Video takes a YouTube link (watch, youtu.be, Shorts), a Vimeo link, or the https address of a video file such as a supplier's .mp4 (`setProductVideo` and `parseVideo` in `packages/core/src/video.ts`, `products.video_url`). Store files carry it.
2. **After the photos**: the product page's gallery gets a video thumbnail after the photos, or shows the video as the main picture when there are no photos. Video files play in the page's own player.
3. **Nothing loads until play**: YouTube and Vimeo players appear only when the buyer presses play, from youtube-nocookie.com and Vimeo with do-not-track, and the still is the product's own photo, so opening the page sends nothing to either.

### Contact page (after launch, part 69)

1. **Contact us**: every store has /contact, linked from the footer, with name, email, an optional order number and the message, in the buyer's language (`sendContactMessage` in `packages/core/src/contact.ts`). The store's business address shows below when the merchant has set one.
2. **Into the inbox**: a message with an order number that matches the buyer's email joins that order's conversation, and buyer support answers it like a question from the order page. Anything else starts its own conversation marked as needing the merchant. Someone else's order number doesn't get anyone into that order.
3. **Replies by email**: the merchant replies from the inbox as usual; without an order the reply is emailed with a link back to the contact page (`sendBuyerMessage`).
4. **Spam**: a hidden field catches bots (they are thanked the same, and nothing is kept), each email address can send three messages an hour, and a store takes at most 50 new contact conversations an hour.

### Product badges (after launch, part 70)

1. **Automatic badges**: product cards show how much is off ("-20%", rounded down) when a product is on sale, "Sold out" when nothing can be ordered (an open pre-order counts as orderable), and "New" for a number of days after a product was added (`cardBadges` in `packages/core/src/badge-rules.ts`, `shops.product_badges`). Admin → Products → Badges turns each on or off; sale and sold out are on, "New" is off until the merchant picks a number of days.
2. **The merchant's own**: any product can have a short label of up to 20 characters, like "Bestseller" (`setProductBadge`, `products.badge`). It comes first on the card and also shows above the title on the product page, with "New".
3. Cards show two badges at most, in the buyer's language, and the theme editor's preview shows them too. Store files carry both settings.

### Photo descriptions (after launch, part 71)

1. **Describe each photo**: under a product's photos, the merchant writes what each one shows, up to 125 characters (`setPhotoTexts` in `packages/core/src/gallery.ts`, `products.image_alts`, kept by photo address). The store's gallery uses it as the photo's alt text, which screen readers read out and image search indexes; a photo without one is described by the product's name and its place ("photo 2 of 3"), as before.
2. **Moves with the photo**: the description follows its photo when it's reordered or becomes the main one, and goes when the photo is removed.
3. **Search listings**: the page lists products on sale that have photos with no description, apart from the listing problems, since most supplier products start without them.
4. **Moving in**: Shopify's "Image Alt Text" comes across with the products file, and store files carry descriptions both ways.

### Campaign audiences (after launch, part 72)

1. **By tag**: an email campaign can go only to subscribers with one customer tag, like "vip" or a tag brought over from Shopify (`audience: "tagged"`, `campaigns.audience_tag`). The editor lists the tags subscribers have, with how many have each (`subscriberTags`).
2. **By product**: or only to subscribers who paid for one product, any time, which suits a matching accessory or a new colour (`audience: "bought"`, `campaigns.audience_product_id`).
3. Only the tag or product the audience needs is kept, a copy of a campaign keeps its audience, and the send button counts the people it goes to now (`campaignAudienceSize`). Everything else about sending is unchanged: only people who said yes, the monthly allowance, and unsubscribes before the email goes out are skipped.

### Sold-out products (after launch, part 73)

1. **Last by default**: collections, search and the home page's product grids list products nobody can order right now after everything that can be bought, whatever the sort, each part keeping its order (`placeSoldOut` in `packages/core/src/badges.ts`, applied in `browseProducts` and `storefrontCatalog`). A product open for pre-order counts as available.
2. **Or hidden, or left where they are**: Admin → Products → Sold-out products (`shops.sold_out_products`: `last`, `hide` or `show`). A hidden product's own page still works, so saved links and back-in-stock alerts keep working.
3. Store files carry the setting.

### What shoppers search for (after launch, part 74)

1. **Counted by word and day**: each plain search on the store adds to a count for its words that day, with how many products it found (`recordSearch` in `packages/core/src/search-terms.ts`, table `search_terms`). Re-sorting or filtering a search isn't counted again.
2. **Private by design**: only the words are kept, never who searched, and anything that looks like an email address or a number of six or more digits isn't kept at all. Counts older than about 13 months are deleted with old visitor events.
3. **On the Analytics page**: the most searched words for the period, with how many results each found last, and the ones that found nothing, apart, since they point at products to add or words to use in titles (`searchReport`). Each opens that search on the store.

### Search fixes (after launch, part 75)

1. **Point a search elsewhere**: when shoppers search for words the products don't use ("lampshade", a misspelling), the merchant points them at words that find what they meant (`setSearchFix` in `packages/core/src/search-terms.ts`, `shops.search_fixes`, up to 100). The whole search has to match, in any case and spacing.
2. **Honest about it**: the store shows the other words' results and says "Showing results for …" in the buyer's language (`browseProducts` returns `showingFor`).
3. **From the report**: each word under "Found nothing" on the Analytics page has a Fix link that opens Admin → Search fixes with it filled in. Store files carry the fixes.

### Lowest price before a discount (after launch, part 76)

1. **The EU rule, worked out**: a product page showing a reduced price (crossed-out price above it) also says "Lowest price in the 30 days before this discount", in the buyer's language (`lowestPricesBefore` in `packages/core/src/lowest-price.ts`). The 30 days end when the running sale started, or else when the option's current price was set.
2. **From the real history**: a database trigger records every price an option has had (`variant_prices`), and earlier sales count at what they charged. When the history doesn't reach back 30 days for an older product, nothing is shown rather than a guess.
3. **Who sees it**: Admin → Sales → Lowest earlier price (`shops.lowest_price_note`): visitors in Europe (the EU, the rest of the EEA, the UK and Switzerland; the default), everyone, or nobody. Store files carry the setting.

### Two-step sign-in (after launch, part 77)

1. **A code after the password**: Admin → Your account → Two-step sign-in. The merchant scans a QR code with any authenticator app (Google Authenticator, 1Password, Authy) and confirms a code; from then on, signing in on the web or in the merchant app asks for the 6-digit code after the password (`packages/core/src/two-step.ts`, standard TOTP with no outside service). Turning it on signs out every other device, and a new password from a reset link doesn't skip the code.
2. **Recovery codes**: ten one-time codes, shown once and kept only as hashes, sign in when the phone is lost. Using one sends an email and takes the merchant to set up again; a fresh set can be made at any time.
3. **Hard to guess, hard to switch off**: each code works once, five wrong codes in 15 minutes stop further tries for that person however many sign-ins are started, and turning it off takes the password and a code. Turning it on or off, and using a recovery code, is emailed. The owner's setup list on Home suggests it.

### Where you're signed in (after launch, part 78)

1. **Every device listed**: Admin → Your account → Where you're signed in shows each browser and merchant app session with a readable name ("Chrome on Mac", "Merchant app"), when it signed in and when it was last used, this device first (`listSignIns` in `packages/core/src/devices.ts`; `sessions.device`, `sessions.last_seen_at`, saved at most every 5 minutes).
2. **Sign out from afar**: any other device can be signed out on its own, or all of them at once (`endSignIn`, `endOtherSignIns`). Only the person's own sessions can be ended.
3. **New-device emails**: signing in on a kind of device the account hasn't used before sends an email with a link to this page (`noteDevice`, `users.known_devices`). The first device on record, at sign-up, sends nothing. Device names are coarse, so this is a hint to look, not proof; two-step sign-in is the real lock.

### Activity (after launch, part 79)

1. **Who did what**: Admin → Activity (owners only) lists what people on the team did, newest first and grouped by day, each linking to what changed: refunds and return decisions, free replacements, orders sent again, released, changed or given tracking, products added, imported, edited and bulk-edited (and undone), discount codes, gift cards, the team (invites, roles, removals, handing over the store), API keys and webhooks, domains, the store's look and status, the plan, payouts and loading a store file (`logActivity` and `listActivity` in `packages/core/src/activity.ts`, table `activity`).
2. **Filter by person**: once a store has a team, one tap shows a single person's actions. Entries keep the person's email, so they still read right after someone leaves.
3. Writing an entry never stops the action itself, and entries are deleted after 400 days by the scheduled job (`pruneActivity`).

### Saved replies (after launch, part 80)

1. **Answers kept once**: Inbox → Saved replies holds up to 30 short answers the merchant gives often, each with a name. A new store can add three starters (where is my order, how long shipping takes, returns) and change them (`packages/core/src/saved-replies.ts`, table `saved_replies`). They travel in the store file.
2. **Filled in per conversation**: in a conversation, "Start from" puts a saved reply in the reply box with `{first_name}`, `{order_number}`, `{tracking_link}` and `{store_name}` filled from the buyer, their order and its tracking. The merchant can still change the words before sending.
3. **Nothing half-filled goes out**: a field the conversation can't fill (no order, or no tracking yet) stays in braces with a warning, and the reply is refused until it's replaced, both for typed replies and edited drafts.

### Buyer inbox in the app (after launch, part 81)

1. **Answer buyers from the phone**: Today has a "Buyer inbox" button for anyone who can see the inbox. It lists conversations that need the merchant (or all of them), and each one opens with its messages, the order it's about or the contact-page email, and a reply box (`apps/mobile/app/inbox/`, app API `GET inbox`, `GET inbox/:id`, `POST inbox/:id/reply`).
2. **Same rules as the web**: saved replies come filled in for the conversation, a field it can't fill stays in braces with a warning and the reply is refused until it's replaced, and owners see buyer support's drafted reply to approve or change.
3. **A push for each waiting question**: a buyer message that buyer support handed to the merchant sends a "Buyer questions that need you" notification that opens the conversation. It can be turned off in the app's notification settings like the others.

### Duplicate a product (after launch, part 82)

1. **Start the next listing from one you have**: the product page has a Duplicate button. The copy is called "Copy of …", gets its own web address and is saved as a draft, so buyers don't see it until the merchant puts it on sale (`duplicateProduct` in `packages/core/src/products.ts`).
2. **What comes along**: photos and their descriptions, options with prices, SKUs and supplier listings, the backup supplier (matched to the copy's own options), settings like badges, search listing, purchase limits and personalisation, and the collections and size charts the original is in. Reviews, questions and translations stay with the original.
3. **Stock isn't counted twice**: a product the merchant stocks themselves starts at 0 in the copy, and the page says so. Supplier products keep the supplier's numbers until the next stock check.

### Put on sale later (after launch, part 83)

1. **A launch time for a draft**: a draft product's page has "Put on sale later". The merchant picks a time in their own time zone, up to a year ahead, and the product waits hidden from buyers. The products list marks it Scheduled (`packages/core/src/publish-later.ts`, column `products.publish_at`).
2. **On sale on time**: due products go on sale on the first store visit after their time, when the admin, app or API lists products, and on the scheduled job for stores nobody visited. It's in the activity log when the merchant schedules or cancels it.
3. **Hand changes win**: putting the product on sale or archiving it by hand (on the web, in the app or with bulk edit) cancels its launch time. A copy made with Duplicate doesn't take the original's time.

### Monday summary (after launch, part 84)

1. **Last week in one email**: every Monday, the people who can see a store's money get its sales, orders, average order, visitors and how many ordered, profit after supplier costs, fees and ads, and the three best sellers, each compared with the week before. Weeks run Monday to Sunday in UTC (`packages/core/src/weekly-summary.ts`).
2. **What's waiting**: problem orders, held orders, paused payouts, warnings, buyer questions and changes waiting for an OK are listed with what to do about them, so a merchant who only reads email still knows what needs them.
3. **Once, and not for nothing**: the daily job sends it once per store per week (claimed before sending), skips stores with a quiet fortnight and nothing waiting, and skips stores opened after the week ended. Each person can turn it off for each store under Your account (`shop_members.weekly_summary`).

### Partners (after launch, part 85)

1. **A code for each creator**: on the Partners page the merchant adds someone who promotes the store, picks their code, what buyers get off (1% to 50%) and the partner's share (0% to 50% of what buyers pay for items, after the discount, not shipping or tax). Partner codes stay off the Marketing codes list (`packages/core/src/partners.ts`, tables `partners` and `partner_payouts`).
2. **Earned, then paid**: a share counts once the order is delivered, or 30 days after it was paid, and refunds come off. The merchant pays partners however they like and records each payment, up to what's owed. Pausing a partner stops the code; what they earned stays.
3. **Links to share and to check**: any code can be shared as `<store>/discount/CODE` (add `?to=/products/lamp` to land on a product), which puts it in the buyer's cart. Each partner has a private page on the platform's address (`/partner/<token>`) with their orders, earnings and payments, and no buyer details. A partner with an email is sent both links when added.

### Spend more, save more (after launch, part 86)

1. **Money off bigger orders, no code**: a percent or amount code with a minimum order can now apply by itself ("Apply it automatically to orders over the minimum" on the Marketing page). Make a few of them for steps, like 10% off over $50 and 15% off over $100; the cart uses the one that saves the most, as it does for buy X get Y offers (`quoteCart` in `packages/core/src/orders.ts`).
2. **A nudge to the next step**: the cart says "Spend $12.00 more to get 15% off your order", in the buyer's language and currency, when the next step saves more than what they get now. Product pages list the steps with the other offers.
3. **Kept simple**: a code the buyer types replaces the steps, wholesale prices don't get them, and money off without a minimum is refused (that's a sale), as is free shipping without a code (that's set under Shipping). Store import keeps automatic steps.

### Buyers cancel their own order (after launch, part 87)

1. **Cancel from the order page**: in the first 12 hours after paying, before it ships, a buyer can open "Cancel this order" on their order page, say why if they like, and cancel. Supplier orders are stopped first, then the whole order is refunded and the buyer gets the refund email (`cancelOrderByBuyer` in `packages/core/src/order-edits.ts`).
2. **Never half done**: if a supplier won't stop its order (it's already packing), nothing changes and the buyer is told to message the store. If the refund itself fails, the buyer is told the store will refund them, and the team gets a "Refund needed" email with a link to the order.
3. **The team hears about it**: everyone who handles orders gets an email saying the buyer cancelled and why. Owners and admins can turn it off under "Buyer cancellations" on the Orders page (`shops.buyer_cancel`, on by default).

### Review requests (after launch, part 88)

1. **Asked once it has arrived**: a few days after an order is delivered (7 by default), the daily job emails the buyer "How was …?" with the items they haven't reviewed yet and a link to the review form on their order page (`sendReviewRequests` in `packages/core/src/review-requests.ts`, columns `shops.review_request_days` and `orders.review_requested_at`).
2. **Only where it fits**: once per order, never for gifts (the buyer didn't receive it), free replacements, refunded orders, orders already reviewed, or buyers who unsubscribed from the store's emails. Each email has a one-click unsubscribe. Orders that arrived more than 30 days before they'd be due are never asked, so turning it on doesn't email old buyers.
3. **Merchant control**: the Reviews page sets the wait (1 to 30 days) or turns it off, and shows how many requests went out in the last 30 days and how many of those orders got a review.

### Send a customer a code (after launch, part 89)

1. **From their page**: a customer's page has "Send a code". The merchant picks a percent or amount off, how many days it works (1 to 90) and an optional message, like an apology for a late parcel, and it's emailed straight away (`sendPersonalCode` in `packages/core/src/personal-codes.ts`).
2. **Theirs alone**: the code works once, only with that customer's email, and stays off the Marketing codes list. The email's "Shop now" link puts it in their cart; share links now take any active code, since checkout checks the email either way.
3. **What happened to it**: the customer's page lists the codes sent to them, and whether each was used (on which order), expired or is still open. Sending one is in the activity log, and erasing the customer turns their codes off.

### Sold out at the supplier (after launch, part 90)

1. **Told once**: after the daily stock check, when every option of a product on sale has run out at its supplier (and at its backup supplier, if it has one), the people who look after products get one email listing it, with a link to the product (`notifySoldOut` in `packages/core/src/supplier-sold-out.ts`). They're told again only if it comes back and runs out again. Products taking pre-orders still sell, so they're left out, and so are products added by hand.
2. **Where it shows**: Home and the phone app's Today screen list it under what needs attention, and so does the Monday summary. The Products page has a "Sold out at the supplier" list that says which ones have a backup supplier that's out too.
3. **What to do**: add a backup supplier so orders go there instead, or take the product off sale. The store sells it again by itself when the supplier restocks.

### Customers as a spreadsheet (after launch, part 91)

1. **One click**: the Customers page has "Download all customers as a spreadsheet", or "these customers" when a search or tag is on, and the file follows it (`customersCsv` in `packages/core/src/customer-export.ts`). It's for a mailing tool, an accountant or the merchant's own records, and up to 20,000 customers go in one file.
2. **What's in it**: email, name, the city and country of their latest order, orders, first and last order dates, whether they're subscribed to emails, whether they've signed in, tags and when they became a customer. The amount spent is only there for people who can see the store's money.
3. **Safe to open**: cells a spreadsheet would run as a formula (a name starting with "=", for example) are defused, like every other download.

### Search as you type (after launch, part 92)

1. **Suggestions**: on the store's search page, typing two letters or more shows up to six matching products under the box, with a photo and the price in the buyer's currency (sales included), or "Sold out". They come from the same search as the results page, so the merchant's search fixes and translations apply (`apps/web/src/app/s/[shop]/search/suggest/route.ts`).
2. **Keyboard and screen readers**: the box is a combobox. The arrow keys move through the suggestions, Enter opens the picked product, the last row runs the full search, and Escape closes the list (a second Escape clears the box). Without JavaScript it's the plain search form it was.
3. **Reports stay honest**: suggestions don't count in the store's search report; only searches the buyer actually runs do.

### Product details (after launch, part 93)

1. **A facts table**: under Details on a product's page in the admin, the merchant writes short facts one per line, like `Material: Aluminium` or `In the box: Lamp, remote, USB-C cable` (up to 20). The store shows them as a table under the description, and search engines get them as product properties (`packages/core/src/product-details.ts`).
2. **Checked as it's saved**: a line without a label and a value says which line it is, and the box keeps what was typed. An empty box removes the table.
3. **Follows the product**: duplicating a product copies its details, store export and import carry them, and they're translated with the title and description, by the merchant or the AI translator, so buyers read them in their language.

### One-time codes (after launch, part 94)

1. **Many codes at once**: under One-time codes on the Marketing page, the merchant makes up to 1,000 codes with one offer (percent off, an amount off or free shipping, with a minimum order and a last day if they like), named for what they're for, like "Parcel cards". Each code is the merchant's start and eight random letters and numbers, like `THANKS-7KQ2M9XA`, without 0/O or 1/I so it's easy to type from a printed card (`packages/core/src/code-batches.ts`).
2. **Each works once**: the first paid order to use a code uses it up, whoever it is, and the others keep working. Turning the batch off stops all its codes at once.
3. **A spreadsheet to print or hand out**: each batch downloads as a CSV with every code and the order that used it, if one has. The list shows how many have been used. Batch codes stay off the regular codes list and out of the store export.

### Bringing reviews over (after launch, part 95)

1. **From the review app used on Shopify**: under "Bring your reviews over" on the Move from Shopify page (linked from Reviews), the merchant adds the CSV exported from Shopify's Product Reviews app or from Judge.me. Each review goes on the product with the same web address, with its name, stars, text (the title as its first line), date and the merchant's reply (`packages/core/src/review-import.ts`).
2. **Kept honest**: reviews that were published stay published, unpublished ones stay hidden, ones waiting to be checked wait here too, and spam stays behind. Reviews written for an order on this store now say "Verified buyer"; imported ones don't, since their orders aren't here. Email addresses, locations and photos aren't brought over.
3. **Safe to repeat**: adding the same file again adds nothing twice, and reviews for products that aren't here yet are counted and named, so the merchant can move those products and add the file again. The Reviews page says where each imported review came from.

### Sale countdown (after launch, part 96)

1. **A real clock**: a sale with an end time can "Count down to the end on the store" (Sales page). In its last 7 days, product pages in the sale show "Ends in 1 day 04:12:33" by the price, ticking each second, in the buyer's language (`countdownTo` in `packages/core/src/sales.ts`, `components/SaleCountdown.tsx`).
2. **A banner for sales on everything**: a store-wide sale that counts down also gets a banner across the store, "Weekend sale: 20% off everything. Ends in …" (the biggest one, when several run). A holiday notice takes the banner's place while the store is on a break.
3. **Honest by design**: the clock counts to the sale's real end, so prices go back when it reaches zero; it can't be set without an end time, and ending the sale early takes it away. Store export and import keep the setting.

### Tag customers automatically (after launch, part 97)

1. **Rules on the Customers page**: "Customers who spent at least $200 get the tag vip", or placed at least N orders, bought a certain product, or haven't ordered in N days. Each rule shows how many customers have its tag and links to them (`packages/core/src/tag-rules.ts`).
2. **Kept in step**: a buyer is tagged the moment their order is paid, existing customers are tagged when the rule is added, and the scheduled job takes tags off after refunds or brings in customers who just lapsed. Removing a rule takes its tag off again.
3. **Your own tags stay yours**: rules only take off tags they added (`customers.auto_tags`), never ones typed on a customer's page; the customer page says which tags came from a rule. Use the tags in the list filter and for email campaign audiences. Store export and import keep the rules.

### Address check at checkout (after launch, part 98)

1. **Fixed before paying, not after the parcel comes back**: checkout checks the postal code against the shape each country uses (US, Canada, UK, Ireland, every EU country, and the other countries stores ship to most) and asks for a US state or Canadian province, with an example: "Check the postal code. In the United Kingdom it looks like SW1A 1AA." (`packages/core/src/address-check.ts`).
2. **Tidied for the supplier**: "sw1a1aa" becomes "SW1A 1AA", "1012ab" becomes "1012 AB", "Texas" becomes "TX", so labels print the way carriers expect.
3. **Everywhere an address is entered**: checkout, payment links, and changing an order's address (by the buyer or the merchant) all use the same check. Countries without a known shape are taken as typed.

### Second checkout reminder with a code (after launch, part 99)

1. **One more nudge, with a reason to come back**: on the Marketing page, under Checkout reminders, "Send a second reminder a day later, with a code" (5% to 50% off). A day after the first reminder, a buyer who still hasn't paid gets a code that works once, only with their email, for 48 hours (`sendAbandonedCartOffers` in `packages/core/src/growth.ts`).
2. **Their cart, on any device**: the email's link (`<store>/pay/<order>/cart?code=…`) puts what's still for sale from that checkout back in the cart with the code added, so it works when the email is opened on a phone.
3. **No code farming, honest counts**: one second reminder per buyer every four days, none if they paid for anything since, and it's the last email about that cart. The reminder stats count sales made with these codes as won back. Store export and import keep the setting.

### Phone number at checkout (after launch, part 100)

1. **For the courier**: checkout can ask for a phone number, optional by default. On the Shipping page, under "Phone number at checkout", a store picks optional, required or don't ask. Numbers are checked ("Include the area code, like +1 512 555 0100") and never used for marketing.
2. **Passed on**: the number goes to the supplier with the order (CJ's `shippingPhone`, AliExpress's `mobile_no`, and your own suppliers' order page), so carriers that need one can deliver.
3. **Where the merchant needs it**: the order page shows it as a call link, the phone app has a Call button, and changing an order's address keeps or updates it. Store export and import keep the setting.

### Tax-exempt buyers (after launch, part 101)

1. **For resellers and charities**: on a customer's page, under "Tax exemption", the merchant enters their exemption certificate or resale number. Only roles that can change tax settings see it (`setTaxExemption` in `packages/core/src/tax-exempt.ts`).
2. **Signed in, no tax**: that buyer pays no tax when they check out signed in to their store account. Typing their email as a guest isn't enough. After-checkout offers and repeat deliveries follow the order they came from, and a payment link the merchant builds for them is exempt too. Where prices include tax, they pay the price shown and the order records no tax.
3. **For the records**: the number is kept on each order, shown on the order page, the buyer's pay page and the invoice, and included in the customer's data download.

### Delivery protection (after launch, part 102)

1. **Offered by the store**: on the Shipping page, under "Delivery protection", a store charges a share of the items (0.5% to 10%, after discounts) with a lowest price (`setDeliveryProtection` in `packages/core/src/delivery-protection.ts`).
2. **Chosen by the buyer**: checkout shows "Protect my delivery for $X" with what it covers. It's never ticked for them, and the summary total follows the box. It's priced in the buyer's currency when they shop in another one. After-checkout offers and repeat deliveries don't add it.
3. **Kept with the order**: `orders.protection_minor` is part of the total (and its check). It's shown on the pay page, the buyer's order page (with how to report a lost or damaged parcel), the confirmation email, the admin order page (next to Send a replacement), the invoice, the orders spreadsheet, the API and the app. Store export and import keep the setting.

### Tracking from a spreadsheet (after launch, part 103)

1. **One upload for many orders**: on the Orders page, under "Add tracking from a spreadsheet", the merchant uploads a CSV with Order, Carrier and Tracking number columns, and optionally Tracking link (`importTracking` in `packages/core/src/tracking-import.ts`). It also reads the orders spreadsheet with a Carrier column added, and the usual column names from other tools.
2. **Start from the waiting list**: "Download the orders waiting for tracking" gives every paid order that hasn't shipped (not held), with who it's for and what's in it, and empty columns to fill in (`/admin/orders/tracking.csv`).
3. **Marked shipped**: a parcel the supplier hasn't shipped gets the tracking; a failed one becomes the merchant's own; an order nobody sent gets a new parcel. The buyer gets the shipping email once. Uploading the same file again changes nothing. Rows that can't be used (no such order, refunded, unpaid, on hold, already shipped with other tracking, a bad tracking number or link) are listed with their line and why. The activity log records how many orders it shipped.

### Packing slips (after launch, part 104)

1. **For packing by hand**: from the Orders page, "Packing slips" shows one slip per order waiting for tracking, each printing on its own sheet (`packingSlips` in `packages/core/src/packing-slips.ts`). Each order page links to its own slip.
2. **What goes in the box, no prices**: the store's name and mailing address, the order number and date, the ship-to address with the courier phone, each item with its SKU, personalisation and pre-order mark, and a tick box. A gift order prints who it's from and their message. The buyer's note shows on screen but isn't printed.
3. **The store's note**: a note at the foot of every slip, like a thank-you or a code for next time (`shops.packing_slip_note`, up to 500 characters). Store export and import keep it.

### Own stock counts down as it sells (after launch, part 105)

1. **Products added by hand**: their stock is the store's own (imported products keep following the supplier's count every day). It comes off when an order is paid, once (`takeOrderStock` in `packages/core/src/own-stock.ts`, `orders.stock_taken_at`), and never below 0. Options left "Not tracked" and pre-ordered lines don't change.
2. **Back on the shelf**: a full refund or a buyer's own cancellation before anything has shipped puts the items back (`returnOrderStock`). Back-in-stock emails go out as usual once it's above 0.
3. **Swaps follow**: when a buyer or the merchant changes an item to another option before it ships, the old option gets its stock back and the new one takes it (`moveLineStock`). The product form says how own stock behaves.

### Running low (after launch, part 106)

1. **Listed on the Products page**: options of products the store added itself (its own stock) with the store's number or fewer left show under "Running low", fewest first, sold-out ones in red (`runningLow` in `packages/core/src/own-stock.ts`). Imported products, drafts and options without a count aren't listed.
2. **One email per option**: the scheduled job emails everyone who looks after products when an option gets down to the number (`notifyLowStock`, `variants.low_stock_notified_at`). It's told again only after it's restocked above the number and runs low again.
3. **The store picks the number**: "Running-low email" on the Products page, 3 by default, 0 turns it off (`shops.restock_alert_at`). Store export and import keep it.

### Local pickup (after launch, part 107)

1. **A free choice at checkout**: a store turns it on under Shipping with its pickup address and how to collect (`shops.local_pickup`, `setLocalPickup` in `packages/core/src/local-pickup.ts`). Buyers in the store's own country see "Pick it up yourself" next to the shipping rates when everything in the cart is the store's own stock. It's never picked for them, costs nothing, and delivery protection isn't offered with it (`orders.pickup`).
2. **Ready, then picked up**: the order page shows Ready for pickup, which emails the buyer the address and instructions once (`markReadyForPickup`, `orders.pickup_ready_at`), and Picked up, which marks the order delivered and sends the usual thank-you (`markPickedUp`). The buyer's order page follows along in their language.
3. **No tracking needed**: pickup orders stay out of the tracking spreadsheet and its import, and get no delivery estimate. An after-checkout offer added to a pickup order is picked up with it when it can be. Store export and import keep the setting.

### Local delivery (after launch, part 108)

1. **The store's own drop-off**: under Shipping, a store lists the postal codes it delivers to by how they start ("787" covers 78701 to 78799), its price, an optional free-over amount and a note like "Next morning" (`shops.local_delivery_area`, `setLocalDelivery` in `packages/core/src/local-delivery.ts`).
2. **At checkout once the postal code is in the area**: buyers in the store's country see "Local delivery" next to the courier rates as soon as their postal code matches and everything in the cart is the store's own stock. It's never picked for them, and delivery protection isn't offered with it (`orders.local_delivery`).
3. **Delivered by hand**: the order page says the store is delivering it and has a Delivered button that marks it delivered and emails the buyer (`markDeliveredByStore`). These orders stay out of the tracking spreadsheet and get no courier estimate. Store export and import keep the area.

### Gift wrapping (after launch, part 109)

1. **The store's own price**: under Shipping, a store offers gift wrapping for a price it sets (0 for free) with a line on what buyers get, like "Kraft paper and a ribbon" (`shops.gift_wrap`, `setGiftWrap` in `packages/core/src/gift-wrap.ts`). Other platforms sell this as an app.
2. **Only on gifts, only if asked**: once a buyer ticks "This order is a gift", checkout offers "Gift wrap it for …", never ticked for them. The order total follows as they tick it (`orders.gift_wrap_minor`, part of `orders_total_matches`). Repeat deliveries and after-checkout offers never add it.
3. **Everywhere the money shows**: the receipt email, order pages, payment page, invoice, order export (a Gift wrap column), API and app show it. The admin order page marks the gift "Wrap it" and the packing slip says so on screen.

### Stock history (after launch, part 110)

1. **Every change, with why**: each change to the store's own stock count is written down with the option, how much, what's left and the reason (`stock_movements`, `recordMovement` in `packages/core/src/own-stock.ts`): the starting count, a sale, an order cancelled or refunded before it shipped, a swap to another option, or a count typed on the product form, in the app or through the API (`recordStockEdits`). Imported products follow the supplier, so they have none.
2. **On the product page**: "Stock history" lists the latest 50 changes, newest first, with links to the orders behind them (`stockHistory`).

### Shipping by weight (after launch, part 111)

1. **What things weigh**: each option of a product can carry its packed weight in grams ("Weight (g)" on the product page, `variants.weight_grams`). Shopify imports bring it in from "Variant Grams", and the store backup keeps it.
2. **Rates for a weight range**: a shipping rate can be limited to orders from and/or up to a weight in kg ("Only for some order weights" when adding a rate; `minWeightGrams`/`maxWeightGrams`, `fitsWeight` in `packages/core/src/shipping.ts`). Both ends count, so "up to 2 kg" includes 2 kg.
3. **At checkout**: the cart's weight is the sum of its options' weights (`quoteCart` returns `weightGrams`; options without one count as nothing). Only rates that fit show, the cheapest fitting one is the default, and an order heavier than every rate's limit is told plainly that there's no shipping for it.

### Restock orders (after launch, part 112)

1. **What you ordered**: for the stock a store keeps itself, the merchant writes down a restock order: who it's from, when it should arrive, and how many of each option at what cost (Restock in the menu; `restock_orders`, `restock_lines`, `createRestockOrder` in `packages/core/src/restock.ts`). Supplier products restock on their own, so they can't be added.
2. **On the way**: each product shows what's still coming for it from open restock orders (`incomingStock`).
3. **When it arrives**: the merchant receives the parcel, all at once or a part at a time (`receiveRestock`). It goes on the stock count (an option that wasn't counted starts counting), the cost paid becomes the option's cost, and the stock history says which restock it arrived on. The order is done once everything is in; cancelling keeps what already arrived.

### Inventory (after launch, part 113)

1. **One list of the stock you keep**: Inventory in the menu shows every counted option of the store's own products, with what's on the shelf, what's on the way from restock orders, and what it's worth at cost and at its price (`inventoryReport` in `packages/core/src/inventory.ts`). Supplier products follow the supplier, so they aren't listed.
2. **How long it lasts**: sales over the last 30 days, less what came back, give a rough "lasts about N days". The soonest to run out come first, and options at or under the running-low number are marked.
3. **As a spreadsheet**: "Download spreadsheet" gives the same list as a CSV (`inventoryCsv`).

### Stock count (after launch, part 114)

1. **Count the shelf**: "Count stock" on the Inventory page lists every option of the store's own stock with what the count says. The merchant types what they counted; options left empty stay as they are (`recordStockCount` in `packages/core/src/inventory.ts`).
2. **What changed**: each option that differs is set to the count, and the difference goes in its stock history as "Stock count". The page says how many options changed, how many items went missing and what they were worth at cost, and how many turned up.

### Customs forms (after launch, part 115)

1. **Customs info on products**: a Customs section on the product page takes the HS code (the tariff number, dots allowed) and the two-letter code of the country it was made in (`setCustomsInfo` in `packages/core/src/customs.ts`). Both go along when the store is copied.
2. **The form**: an order shipping to another country than the store's gets a "Customs form" link next to the packing slip. It prints a declaration with from and to, each item's HS code, origin, quantity, weight and value, the totals, gift or sale, and a line to sign. Products still missing a code are named in a warning that doesn't print.

### Barcodes (after launch, part 116)

1. **Barcode and SKU on each option**: the product form takes an option's SKU and barcode (a UPC or EAN from the maker, or the store's own code). Two options in the store can't share a barcode, and a copied product starts without them (`packages/core/src/barcode.ts`, `checkBarcodes` in `products.ts`). Shopify's "Variant Barcode" column comes over on import.
2. **Labels**: "Print labels" on a product page prints a sheet of labels with the title, option, price and a Code 128 barcode of the barcode, or of the SKU when there's none. It starts at one label for each item on the shelf.
3. **Scan to count**: the stock count page has a scan box. A scanner types the code and presses Enter, and each scan adds one to that option's count, found by barcode or SKU.

### Pick list (after launch, part 117)

1. **One walk of the shelf**: "Pick list" on the packing slips page adds up what the orders waiting to ship need from the store's own stock, per option, sorted by SKU, with the barcode, the orders each goes in, and what's left once they're picked (in red when it's short). Items a supplier ships are left off and counted in a note (`pickList` in `packages/core/src/pick-list.ts`).

### Shelf locations (after launch, part 118)

1. **Where it sits**: each option of the store's own stock can have a shelf location, like A3 or Back room. The pick list is sorted by it, so one walk of the stock room picks everything. The stock count lists options in shelf order, and the inventory page and spreadsheet show it. It goes along when the store is copied.

### Suggested restock (after launch, part 119)

1. **Order from what sold**: "Suggest a restock" on the Inventory page opens a new restock order filled in with enough of each option to last the next 30, 60 or 90 days at the pace of the last 30, less what's on the shelf and already on the way. Options that didn't sell are left empty. The merchant changes anything before saving (`restockSuggestions` in `packages/core/src/inventory.ts`).

### Emailing a restock order (after launch, part 120)

1. **Send it to the supplier**: a restock order can carry the supplier's email. "Email this order" on the order sends them a purchase order with what's still to come, SKUs, agreed costs and the total, when it's wanted, the store's mailing address and the note. The reply goes to whoever sent it. It can't go out twice within a few minutes by accident, and the page shows when it was last sent (`emailRestockOrder` in `packages/core/src/restock.ts`, migration 0103).

### Age check (after launch, part 121)

1. **Minimum age on a product**: alcohol, vapes, knives and the like can carry a minimum age (13 to 25) from the product page. The store's product page says who it's for, and checkout asks the buyer to tick "I confirm I'm 21 or older" (the highest age in the cart) before they can pay. The order keeps the age they confirmed and the order page says to have ID checked on delivery. Payment links, repeat deliveries and after-checkout offers don't ask again (`setMinAge` in `packages/core/src/age-check.ts`, the check in `startCheckout`, migration 0104).

### Buyer survey (after launch, part 122)

1. **How did you hear about us?**: the store can ask buyers one question on their order page right after paying, with 2 to 8 answers and an optional "Other" box. Each order keeps its answer, which shows on the order page. The Buyer survey page lists orders, share and sales per answer for the last 30 days, 90 days or year, and what people typed under "Other". Replacements, repeat deliveries and add-ons are not asked, and buyers can answer for 30 days (`packages/core/src/survey.ts`, migration 0105).

### Blocked buyers (after launch, part 123)

1. **Block a buyer**: "Block this buyer" on an order blocks its email and delivery address, with a note only the merchant sees. The Blocked buyers page (from Customers) lists them, blocks an email typed by hand, and unblocks. A blocked email, or a new email at a blocked address (however the street is typed), gets "We can't take this order" at checkout before any payment, so a buyer behind chargebacks can't cost the store another dispute fee. Repeat deliveries and after-checkout offers carry on (`packages/core/src/blocklist.ts`, migration 0106).

### Store policies (after launch, part 124)

1. **Policies written from your settings**: the Pages page drafts Returns and refunds, Shipping, Privacy policy and Terms of service from the store's own settings: the return window and instructions, buyer cancelling, each shipping zone's rates, free-shipping amounts and delivery times, processing days, pickup and local delivery, ad tracking and the legal name. The merchant reads each one, ticks the ones they want and adds them as ordinary pages to edit. A page already at /pages/returns (and so on) is never replaced. The returns page also meets the trust checklist's returns item (`packages/core/src/policies.ts`, no migration).

### Tips (after launch, part 125)

1. **Tips at checkout**: from Checkout add-ons, the store can ask for a tip with up to three percentages (10, 15 and 20 to start) and a thank-you line. Checkout shows each with what it comes to in the buyer's currency, and "No tip" is always first and picked. A tip is on the goods after any discount, no tax is added to it and the per-sale fee doesn't touch it. It shows on the receipt email, the order and payment pages, the invoice, the order page in admin, the orders spreadsheet and the API. Payment links, repeat deliveries and after-checkout offers never ask (`packages/core/src/tips.ts`, migration 0107).

### Reorder reminders (after launch, part 126)

1. **Running low?**: a product that runs out (coffee, vitamins, refills) can say how long it usually lasts, from 7 to 180 days. That many days after an order arrives (or after payment, when the courier never said), the buyer gets one email with a link back to the product. Never for gifts, replacements or repeat deliveries, never once they've bought it again, never to buyers who unsubscribed, and never for orders more than 30 days past due, so turning it on doesn't email old buyers. The daily job sends them (`packages/core/src/reorder-reminders.ts`, migration 0108).
