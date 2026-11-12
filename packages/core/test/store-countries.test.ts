import { describe, expect, it } from "vitest";
import { createTestDb } from "@sf/db";
import { CROSS_BORDER_COUNTRIES, createShop, payoutGuide, payoutRoute, signUp, STORE_COUNTRIES, STRIPE_COUNTRIES, UserError } from "../src";

describe("store countries", () => {
  it("opens stores outside the launch countries, selling in US dollars", async () => {
    const db = await createTestDb();
    const user = await signUp(db, { email: "aida@example.com", password: "correct horse" });
    const kz = await createShop(db, user.id, { name: "Steppe Lamps", country: "KZ" });
    expect(kz).toMatchObject({ country: "KZ", currency: "USD", pricesIncludeTax: false });
    const au = await createShop(db, user.id, { name: "Harbour Lamps", country: "AU" });
    expect(au).toMatchObject({ currency: "USD", pricesIncludeTax: false });
    // Launch countries keep their own currency and tax display.
    expect(await createShop(db, user.id, { name: "Rhine Lamps", country: "DE" })).toMatchObject({ currency: "EUR", pricesIncludeTax: true });
    await expect(createShop(db, user.id, { name: "Nowhere", country: "ZZ" })).rejects.toThrow(UserError);
  });

  it("pays cross-border countries through Stripe's cross-border payouts", () => {
    expect(new Set(STORE_COUNTRIES).size).toBe(STORE_COUNTRIES.length);
    expect(payoutRoute("US")).toBe("own_account");
    expect(payoutRoute("AU")).toBe("own_account");
    expect(payoutRoute("TR")).toBe("cross_border");
    expect(STRIPE_COUNTRIES.some((c) => (CROSS_BORDER_COUNTRIES as readonly string[]).includes(c))).toBe(false);
    expect(payoutGuide("TR")).toMatchObject({ bank: expect.stringContaining("in Türkiye"), crossBorder: expect.stringContaining("cross-border payouts") });
    expect(payoutGuide("AU")).toMatchObject({ bank: expect.stringContaining("in Australia"), crossBorder: null });
    expect(payoutGuide("US").crossBorder).toBeNull();
  });
});
