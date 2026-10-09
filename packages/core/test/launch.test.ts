import { describe, expect, it } from "vitest";
import { createTestDb } from "@sf/db";
import { createSession, getSessionUser, launchChecks, LogMailer, MAX_FAILED_SIGN_INS, requestPasswordReset, resetPassword, signIn, signUp } from "../src";

const PROD = {
  NEXT_PUBLIC_BRAND_NAME: "Lumen",
  NEXT_PUBLIC_ROOT_DOMAIN: "lumen.shop",
  DATABASE_URL: "postgres://x",
  PAYMENTS_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_live_1",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_1",
  STRIPE_WEBHOOK_SECRET: "whsec_1",
  STRIPE_PRICE_STARTER: "price_1",
  STRIPE_PRICE_GROWTH: "price_2",
  STRIPE_PRICE_SCALE: "price_3",
  RESEND_API_KEY: "re_1",
  EMAIL_FROM: "Lumen <hello@lumen.shop>",
  CRON_SECRET: "x".repeat(40),
  STAFF_EMAILS: "ops@lumen.shop",
  DEMO_SUPPLIER: "off",
  CJ_API_KEY: "cj",
  VERCEL_API_TOKEN: "t",
  VERCEL_PROJECT_ID: "p",
  ANTHROPIC_API_KEY: "k",
};

describe("launch preflight", () => {
  it("passes a complete production setup", () => {
    expect(launchChecks(PROD).filter((c) => !c.ok)).toEqual([]);
  });

  it("blocks development defaults and test switches", () => {
    const failing = (env: Record<string, string>) => launchChecks(env).filter((c) => !c.ok).map((c) => c.id);
    expect(failing({ ...PROD, STRIPE_SECRET_KEY: "sk_test_1" })).toEqual(["stripe-live"]);
    expect(failing({ ...PROD, DEMO_SUPPLIER: "on", WEBHOOKS_ALLOW_PRIVATE: "on" })).toEqual(["demo-supplier", "test-switches"]);
    expect(failing({ ...PROD, NEXT_PUBLIC_ROOT_DOMAIN: "storefront-test.vercel.app", CRON_SECRET: "short" })).toEqual(["domain", "cron"]);
    const aliexpress = { ALIEXPRESS_APP_KEY: "k", ALIEXPRESS_APP_SECRET: "s", ALIEXPRESS_ACCESS_TOKEN: "t" };
    expect(failing({ ...PROD, CJ_API_KEY: "" })).toEqual(["supplier"]);
    expect(failing({ ...PROD, CJ_API_KEY: "", ...aliexpress })).toEqual([]);
    expect(failing({ ...PROD, CJ_API_KEY: "", ...aliexpress, ALIEXPRESS_ACCESS_TOKEN: "" })).toEqual(["supplier"]);
    const blank = launchChecks({});
    expect(blank.filter((c) => !c.ok && c.severity === "blocker").length).toBeGreaterThan(8);
  });
});

describe("sign-in protection and password reset", () => {
  it("slows down password guessing for one email", async () => {
    const db = await createTestDb();
    await signUp(db, { email: "ada@example.com", password: "correct horse" });
    for (let i = 0; i < MAX_FAILED_SIGN_INS; i++) await expect(signIn(db, { email: "ada@example.com", password: "wrong" })).rejects.toThrow("don't match");
    await expect(signIn(db, { email: "ADA@example.com", password: "correct horse" })).rejects.toThrow("Too many wrong passwords");
    // Fifteen minutes later it works again.
    expect(await signIn(db, { email: "ada@example.com", password: "correct horse" }, new Date(Date.now() + 16 * 60_000))).toMatchObject({ email: "ada@example.com" });
  });

  it("emails a one-time link that sets a new password and signs out other sessions", async () => {
    const db = await createTestDb();
    const user = await signUp(db, { email: "ada@example.com", password: "correct horse" });
    const { token: session } = await createSession(db, user.id);
    const mailer = new LogMailer(true);
    const ctx = { db, mailer, brand: "Lumen", resetUrl: (t: string) => `https://lumen.shop/reset/${t}` };

    await requestPasswordReset(ctx, "nobody@example.com");
    expect(mailer.sent).toHaveLength(0);
    await requestPasswordReset(ctx, " Ada@Example.com ");
    expect(mailer.sent[0]).toMatchObject({ to: "ada@example.com", subject: "Reset your Lumen password" });
    const token = mailer.sent[0]!.text.match(/reset\/(\S+)/)![1]!;

    await expect(resetPassword(db, token, "short")).rejects.toThrow("at least 8");
    await resetPassword(db, token, "new battery staple");
    await expect(resetPassword(db, token, "another one here")).rejects.toThrow("expired or was already used");
    expect(await getSessionUser(db, session)).toBeNull();
    await expect(signIn(db, { email: "ada@example.com", password: "correct horse" })).rejects.toThrow("don't match");
    expect(await signIn(db, { email: "ada@example.com", password: "new battery staple" })).toMatchObject({ id: user.id });

    // At most three links an hour, and links expire.
    await requestPasswordReset(ctx, "ada@example.com");
    await requestPasswordReset(ctx, "ada@example.com");
    await requestPasswordReset(ctx, "ada@example.com");
    expect(mailer.sent).toHaveLength(3);
    const late = mailer.sent[2]!.text.match(/reset\/(\S+)/)![1]!;
    await expect(resetPassword(db, late, "new battery staple 2", new Date(Date.now() + 61 * 60_000))).rejects.toThrow("expired");
  });
});
