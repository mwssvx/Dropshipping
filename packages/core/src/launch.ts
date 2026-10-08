// The launch preflight: settings that must be right before real merchants and real money.
// No imports, so the command-line version (scripts/preflight.mjs) runs with plain Node.

export type LaunchCheck = {
  id: string;
  area: string;
  label: string;
  ok: boolean;
  /** blocker: don't launch without it. warning: works, but something is missing or limited. */
  severity: "blocker" | "warning";
  fix: string;
};

type Env = Record<string, string | undefined>;

export function launchChecks(env: Env): LaunchCheck[] {
  const set = (k: string) => !!env[k]?.trim();
  const on = (k: string, v: string) => env[k]?.trim().toLowerCase() === v;
  const root = env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";
  const checks: LaunchCheck[] = [];
  const add = (ok: boolean, c: Omit<LaunchCheck, "ok">) => checks.push({ ...c, ok });

  add(set("NEXT_PUBLIC_BRAND_NAME") && env.NEXT_PUBLIC_BRAND_NAME !== "Storefront", {
    id: "brand", area: "Brand", label: "The product has its final name", severity: "warning",
    fix: "Set NEXT_PUBLIC_BRAND_NAME (and the name in apps/mobile/app.json) once the trademark check is done.",
  });
  add(!!root && !/^(localhost|127\.0\.0\.1)(:|$)/.test(root) && !root.endsWith(".vercel.app"), {
    id: "domain", area: "Brand", label: "Our own domain is set", severity: "blocker",
    fix: "Set NEXT_PUBLIC_ROOT_DOMAIN to the real domain, with a wildcard DNS record for store subdomains.",
  });
  add(set("DATABASE_URL"), {
    id: "database", area: "Data", label: "A real Postgres database", severity: "blocker",
    fix: "Set DATABASE_URL to the Supabase connection string. Without it the app uses an in-process test database.",
  });
  add(on("PAYMENTS_PROVIDER", "stripe"), {
    id: "payments", area: "Payments", label: "Stripe is the payment provider", severity: "blocker",
    fix: "Set PAYMENTS_PROVIDER=stripe. The fake provider takes no real money.",
  });
  add(!!env.STRIPE_SECRET_KEY?.startsWith("sk_live_") && !!env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_live_"), {
    id: "stripe-live", area: "Payments", label: "Stripe live keys", severity: "blocker",
    fix: "Use the live secret and publishable keys (sk_live_, pk_live_) after Stripe activates the account and Connect.",
  });
  add(!!env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"), {
    id: "stripe-webhook", area: "Payments", label: "Stripe webhook secret", severity: "blocker",
    fix: "Add a webhook endpoint for /api/webhooks/payments in Stripe (with Connect events) and set STRIPE_WEBHOOK_SECRET.",
  });
  add(["STRIPE_PRICE_STARTER", "STRIPE_PRICE_GROWTH", "STRIPE_PRICE_SCALE"].every((k) => env[k]?.startsWith("price_")), {
    id: "stripe-prices", area: "Payments", label: "Prices for the paid plans", severity: "blocker",
    fix: "Create monthly prices of $19, $49 and $149 in Stripe Billing and set STRIPE_PRICE_STARTER, _GROWTH and _SCALE.",
  });
  add(set("RESEND_API_KEY") && set("EMAIL_FROM") && !/example\.(com|org)/.test(env.EMAIL_FROM ?? ""), {
    id: "email", area: "Email", label: "Email sending", severity: "blocker",
    fix: "Verify the sending domain in Resend, then set RESEND_API_KEY and EMAIL_FROM. Order emails and password resets need it.",
  });
  add((env.CRON_SECRET?.length ?? 0) >= 32, {
    id: "cron", area: "Operations", label: "Scheduled job is protected", severity: "blocker",
    fix: "Set CRON_SECRET to a random value of at least 32 characters, and schedule /api/cron/fulfillment every 10 minutes.",
  });
  add(set("STAFF_EMAILS"), {
    id: "staff", area: "Operations", label: "Staff who answer appeals", severity: "warning",
    fix: "Set STAFF_EMAILS so someone can open /staff to answer appeals and escalations.",
  });
  add(!on("DEMO_SUPPLIER", "on"), {
    id: "demo-supplier", area: "Suppliers", label: "Demo supplier is off", severity: "blocker",
    fix: "Set DEMO_SUPPLIER=off so stores can't sell demo products nobody will ship.",
  });
  add(set("CJ_API_KEY"), {
    id: "cj", area: "Suppliers", label: "CJ Dropshipping is connected", severity: "blocker",
    fix: "Set CJ_API_KEY and place one test order end to end before launch.",
  });
  add(set("VERCEL_API_TOKEN") && set("VERCEL_PROJECT_ID"), {
    id: "domains", area: "Domains", label: "Custom domains get certificates", severity: "warning",
    fix: "Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID so domains merchants connect are added to the project automatically.",
  });
  add(set("ANTHROPIC_API_KEY"), {
    id: "ai", area: "AI", label: "AI agents use the real model", severity: "warning",
    fix: "Set ANTHROPIC_API_KEY. Without it a demo brain answers, which is fine for testing only.",
  });
  add(!on("PUSH_PROVIDER", "log"), {
    id: "push", area: "App", label: "Push notifications are sent", severity: "warning",
    fix: "Leave PUSH_PROVIDER empty in production so notifications go through Expo.",
  });
  add(!on("DOMAIN_CHECKS", "off") && !on("WEBHOOKS_ALLOW_PRIVATE", "on") && !on("EMAIL_PREVIEW", "on"), {
    id: "test-switches", area: "Security", label: "Test-only switches are off", severity: "blocker",
    fix: "Remove DOMAIN_CHECKS=off, WEBHOOKS_ALLOW_PRIVATE=on and EMAIL_PREVIEW=on. They skip checks that protect stores.",
  });
  add(!(env.APP_WEB_ORIGINS ?? "").includes("localhost"), {
    id: "app-origins", area: "Security", label: "No local addresses can call the app API", severity: "warning",
    fix: "Remove localhost entries from APP_WEB_ORIGINS.",
  });
  return checks;
}

/** Steps only a person can do; listed with the automatic checks so nothing is forgotten. */
export const LAUNCH_TASKS = [
  "Pick the final name and run a trademark search.",
  "Have a lawyer review the terms, privacy policy, acceptable use policy and merchant agreement drafts.",
  "Activate Stripe (live mode, Connect platform profile, payouts) and confirm the countries we launch in.",
  "Create the CJ Dropshipping account and place one test order end to end.",
  "Set up Supabase (production project, backups on) and Resend (verified sending domain).",
  "Buy the domain and point it, with a wildcard for store subdomains, at Vercel.",
  "Create the Apple and Google developer accounts; send the app to TestFlight and Play internal testing.",
  "Write the App Store and Google Play listings (drafts in docs/store-listings.md) and take store screenshots.",
  "Run the preflight (pnpm preflight) against the production settings until nothing is blocking.",
] as const;
