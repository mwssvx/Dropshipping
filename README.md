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
| `packages/core` | Business logic with tests: auth, stores, products, cart pricing, checkout, payment webhooks, supplier import, order routing, tracking, emails |

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000, no accounts or keys needed
pnpm test           # core unit and integration tests
pnpm --filter @sf/web build && pnpm e2e   # end-to-end, desktop and phone
pnpm --filter @sf/mobile start            # the app in Expo Go
```

With no environment variables, the app uses an in-process Postgres stored in `apps/web/.data/`
a fake payment provider with signed webhooks, and a demo supplier (try the links on
Products > Import from supplier), so the whole flow works offline.
See `.env.example` and `docs/accounts.md` for the real services.

## Milestones

- [x] M0 Foundations: monorepo, schema, CI workflow, design tokens
- [x] M1 Vertical slice: sign up, create a store, add a product, buy it with a test payment, see it paid in admin
- [x] M2 Dropshipping: import by link, automatic order routing, tracking sync, problem orders, order emails (CJ adapter awaits a live key)

### How an order moves (M2)

1. Payment webhook marks the order paid. Right after the response, the buyer gets a confirmation email and each supplier's items are placed with that supplier (`routeOrder`). One fulfilment row per supplier, claimed before the call, so retries never double-order.
2. A refusal (out of stock, address, wallet balance) becomes a **problem order** with a plain-language fix: try again, or ship it yourself and add tracking.
3. Every 30 minutes `/api/cron/fulfillment` places any paid order that was missed and pulls tracking. The first tracking number emails the buyer; delivery emails again. No tracking 7 days after placing flags the order as late.
- [ ] M3 Storefront themes and visual editor, custom domains
- [ ] M4 Money and trust: Stripe Connect, Money page, Stripe Tax, refunds, verified badge
- [ ] M5 AI agents
- [ ] M6 Mobile app features
- [ ] M7 Growth basics
- [ ] M8 Launch
