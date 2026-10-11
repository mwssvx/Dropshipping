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
