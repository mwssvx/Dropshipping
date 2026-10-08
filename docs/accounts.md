# Accounts and keys you create

Nothing here was signed up for on your behalf. Until these exist, the app runs on local stand-ins.

| service | needed for | stand-in today | what to set |
| --- | --- | --- | --- |
| Supabase | production database and login | PGlite (local Postgres) + built-in email/password | `DATABASE_URL`; Supabase Auth replaces the dev auth module in M4 |
| Stripe | real payments, Connect payouts, Tax, plan billing | `FakePaymentProvider` with signed webhooks | `PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| CJ Dropshipping | supplier import and fulfilment | demo supplier (`DEMO_SUPPLIER=on`); `CjSupplier` is written but not yet run against a live account | `CJ_API_KEY` (from CJ: My CJ > Authorization > API). Turn on wallet auto-pay in CJ so placed orders get paid |
| Vercel | hosting previews and production; the 30-minute fulfilment job in `apps/web/vercel.json` | none (runs locally) | connect the repo, set `CRON_SECRET`. Crons more often than daily need a paid plan |
| Expo (EAS) | building the iOS and Android app | Expo Go | `eas init` |
| Apple Developer ($99/yr), Google Play ($25 once) | publishing the app | none | needed before M6 store submission |
| Resend | order emails (confirmation, shipped, delivered) | logged to the console and the `emails` table | `RESEND_API_KEY`, `EMAIL_FROM` on a verified domain |
| Anthropic API | AI agents (M5) | none | `ANTHROPIC_API_KEY` |
| A domain | the platform's address | `localhost` | set `NEXT_PUBLIC_ROOT_DOMAIN` |
