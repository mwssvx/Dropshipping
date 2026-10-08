# Accounts and keys you create

Nothing here was signed up for on your behalf. Until these exist, the app runs on local stand-ins.

| service | needed for | stand-in today | what to set |
| --- | --- | --- | --- |
| GitHub repository | storing the code, CI | git bundle in project files | create an empty private repo, then share it with Claude |
| Supabase | production database and login | PGlite (local Postgres) + built-in email/password | `DATABASE_URL`; Supabase Auth replaces the dev auth module in M4 |
| Stripe | real payments, Connect payouts, Tax, plan billing | `FakePaymentProvider` with signed webhooks | `PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| CJ Dropshipping | supplier import and fulfilment (M2) | `CjSupplier` stub | `SUPPLIER_PROVIDER=cj`, `CJ_API_KEY` |
| Vercel | hosting previews and production | none (runs locally) | connect the repo |
| Expo (EAS) | building the iOS and Android app | Expo Go | `eas init` |
| Apple Developer ($99/yr), Google Play ($25 once) | publishing the app | none | needed before M6 store submission |
| Resend | order emails | not sent yet | `RESEND_API_KEY` (M2) |
| Anthropic API | AI agents (M5) | none | `ANTHROPIC_API_KEY` |
| A domain | the platform's address | `localhost` | set `NEXT_PUBLIC_ROOT_DOMAIN` |
