# Launch checklist (M8)

Run `pnpm preflight` with the production settings (for example `node --env-file=apps/web/.env.production packages/core/scripts/preflight.mjs`) or open **/staff/launch** on the production deployment. Both run the same checks (`packages/core/src/launch.ts`) and list what's blocking.

## Settings the preflight checks

| area | must be true | how |
| --- | --- | --- |
| Brand | final name set (warning) | `NEXT_PUBLIC_BRAND_NAME`, plus `name` in `apps/mobile/app.json` |
| Brand | our own domain | `NEXT_PUBLIC_ROOT_DOMAIN`, with `*.<domain>` on the Vercel project |
| Data | real Postgres | `DATABASE_URL` (Supabase, with daily backups and point-in-time recovery on) |
| Payments | Stripe in live mode | `PAYMENTS_PROVIDER=stripe`, `sk_live_`/`pk_live_` keys, `STRIPE_WEBHOOK_SECRET`, three `STRIPE_PRICE_*` ids |
| Email | real sending | `RESEND_API_KEY`, `EMAIL_FROM` on a verified domain (password resets depend on it) |
| Operations | protected scheduled job | `CRON_SECRET` of 32+ characters; schedule `/api/cron/fulfillment` every 10 to 30 minutes (needs a paid Vercel plan, or an external scheduler) |
| Operations | staff for appeals (warning) | `STAFF_EMAILS` |
| Suppliers | demo off, CJ on | `DEMO_SUPPLIER=off`, `CJ_API_KEY` |
| Domains | certificates for merchants' domains (warning) | `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID` |
| AI | real model (warning) | `ANTHROPIC_API_KEY`, with a monthly spend limit in the Anthropic console |
| App | push via Expo (warning) | leave `PUSH_PROVIDER` empty |
| Security | test switches off | no `DOMAIN_CHECKS=off`, `WEBHOOKS_ALLOW_PRIVATE=on` or `EMAIL_PREVIEW=on`; no localhost in `APP_WEB_ORIGINS` |

## Done by a person

1. Pick the final name and run a trademark search (USPTO, UKIPO, EUIPO, CIPO) in the launch countries.
2. Have a lawyer review the four drafts at `/legal/terms`, `/legal/privacy`, `/legal/acceptable-use` and `/legal/merchant-agreement` (source: `apps/web/src/app/(marketing)/legal/docs.ts`), fill the `[bracketed]` details, then remove the "Draft for review" banner.
3. Activate Stripe: live mode, Connect platform profile, the countries we launch in, and the webhook endpoints in `docs/accounts.md`.
4. CJ Dropshipping: account, API key, wallet auto-pay, and one real test order end to end.
5. Supabase production project and Resend sending domain.
6. Buy the domain and point it, plus a wildcard, at Vercel.
7. Apple and Google developer accounts; TestFlight and Play internal testing builds (`eas build`, `eas submit`).
8. Store listings: drafts in `docs/store-listings.md`; screenshots from the app (the M6 screens are a starting point).
9. Re-run the preflight until nothing is blocking, then give the go.

## Product promises to check before launch

- The plan blurbs in `packages/core/src/plans.ts` mention "priority support" (Growth) and "staff accounts and advanced analytics" (Scale). Staff accounts are on the after-launch list. Build them, or reword the blurbs, before taking money for Scale.
- The landing page says stores can be based in the US, UK, EU and Canada. Keep it in line with the Stripe countries you turn on.

## Already in place for launch

- Sign-in protection: 8 wrong passwords for one email in 15 minutes pause sign-in for that email.
- Password reset by email: one-time links, valid for an hour, at most three an hour, and a reset signs the person out everywhere.
- Security headers on every response: no framing by other sites, `nosniff`, a strict referrer policy, HSTS, and camera, microphone and location turned off.
- `/api/health` for uptime monitors (200 with the database reachable, 503 if not).
- Friendly 404 and error pages; errors show a code support can look up in the logs.
- Platform `robots.txt` and `sitemap.xml`; stores keep their own.
- Old visitor events, sign-in attempts and reset links are pruned by the scheduled job.

## After the go

- Watch `/api/health`, Vercel runtime errors and the Stripe dashboard on day one.
- Keep `/staff` open for escalations and appeals.
