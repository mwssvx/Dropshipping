import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, schema } from "@sf/db";
import { cardSettingsUrl, createShop, decideAppeal, FakePaymentProvider, sendNotice, signUp, submitAppeal, syncPlanBilling } from "../src";

describe("plan billing while a store is paused", () => {
  it("stops charging the plan while we've paused the store, and starts again when it reopens", async () => {
    const db = await createTestDb();
    const payments = new FakePaymentProvider();
    const user = await signUp(db, { email: "owner@example.com", password: "correct horse" });
    const shop = await createShop(db, user.id, { name: "Glow Lamps", country: "US" });
    // Free plan, no subscription: nothing to pause.
    expect(await syncPlanBilling(db, payments, shop.id)).toBeNull();

    await db.update(schema.shops).set({ plan: "growth", billingCustomerId: "cus_1", billingSubscriptionId: "sub_1" }).where(eq(schema.shops.id, shop.id));
    const pause = await sendNotice(db, { shopId: shop.id, kind: "paused", reason: "identity", explanation: "We couldn't confirm who owns this store from the documents sent.", by: "staff@x" });
    expect(await syncPlanBilling(db, payments, shop.id)).toEqual({ paused: true });

    const appeal = await submitAppeal(db, shop.id, pause.id, "I've sent a clearer photo of my passport with the address page too.");
    const decided = await decideAppeal(db, appeal.id, { accept: true, response: "Thanks, confirmed now.", by: "staff@x" });
    expect(decided).toEqual({ reinstated: true, shopId: shop.id });
    expect(await syncPlanBilling(db, payments, shop.id)).toEqual({ paused: false });
    expect(payments.billingPauses).toEqual([
      { subscriptionId: "sub_1", paused: true },
      { subscriptionId: "sub_1", paused: false },
    ]);
  });

  it("has no card page without a billing customer, and none in test mode", async () => {
    const payments = new FakePaymentProvider();
    expect(await cardSettingsUrl(payments, { billingCustomerId: null }, "http://x/plan")).toBeNull();
    expect(await cardSettingsUrl(payments, { billingCustomerId: "cus_1" }, "http://x/plan")).toBeNull();
  });
});
