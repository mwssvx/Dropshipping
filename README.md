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
| `packages/core` | Business logic with tests: auth, stores, products, cart pricing, checkout, payment webhooks, supplier interface |

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000, no accounts or keys needed
pnpm test           # core unit and integration tests
pnpm --filter @sf/web build && pnpm e2e   # end-to-end, desktop and phone
pnpm --filter @sf/mobile start            # the app in Expo Go
```

With no environment variables, the app uses an in-process Postgres stored in `apps/web/.data/`
and a fake payment provider with signed webhooks, so the whole flow works offline.
See `.env.example` and `docs/accounts.md` for the real services.

## Milestones

- [x] M0 Foundations: monorepo, schema, CI workflow, design tokens
- [x] M1 Vertical slice: sign up, create a store, add a product, buy it with a test payment, see it paid in admin
- [ ] M2 Dropshipping: CJ import by link, automatic order routing, tracking
- [ ] M3 Storefront themes and visual editor, custom domains
- [ ] M4 Money and trust: Stripe Connect, Money page, Stripe Tax, refunds, verified badge
- [ ] M5 AI agents
- [ ] M6 Mobile app features
- [ ] M7 Growth basics
- [ ] M8 Launch
