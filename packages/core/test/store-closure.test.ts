import { describe, expect, it } from "vitest";
import { activeClosure, DemoModel, enterStorePassword, hasStoreAccess, onHoliday, setStoreClosure, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Grace Hopper", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const now = new Date("2026-10-11T12:00:00Z");

describe("closing the store for a while", () => {
  it("hides the store behind a password until the opening day", async () => {
    const f = await makeFixture(new DemoModel());
    let shop = await f.shop();
    await expect(setStoreClosure(f.db, shop, { mode: "password" }, now)).rejects.toThrow("Choose a password");
    await expect(setStoreClosure(f.db, shop, { mode: "password", password: "abc" }, now)).rejects.toThrow("4 to 100 characters");
    await expect(setStoreClosure(f.db, shop, { mode: "password", password: "glow2026", until: "2026-10-11" }, now)).rejects.toThrow("after today");
    await expect(setStoreClosure(f.db, shop, { mode: "password", password: "glow2026", until: "2026-02-30" }, now)).rejects.toThrow("YYYY-MM-DD");
    await expect(setStoreClosure(f.db, shop, { mode: "password", password: "glow2026", until: "2028-01-01" }, now)).rejects.toThrow("within the next year");
    await setStoreClosure(f.db, shop, { mode: "password", password: " glow2026 ", message: "Lamps that glow, from November.", until: "2026-11-01" }, now);
    shop = await f.shop();
    expect(shop.closure).toMatchObject({ mode: "password", message: "Lamps that glow, from November.", until: "2026-11-01" });
    expect(shop.closure!.passwordHash).not.toContain("glow2026");

    // Visitors need the password; the right one gives the cookie value that lets them in.
    expect(hasStoreAccess(shop, undefined, now)).toBe(false);
    expect(await enterStorePassword(shop, "wrong", now)).toBeNull();
    const key = await enterStorePassword(shop, "glow2026", now);
    expect(key).toBeTruthy();
    expect(hasStoreAccess(shop, key, now)).toBe(true);
    expect(hasStoreAccess(shop, `${key}x`, now)).toBe(false);

    // Changing the message keeps the password; a new password signs everyone out.
    await setStoreClosure(f.db, shop, { mode: "password", message: "Opening soon" }, now);
    shop = await f.shop();
    expect(hasStoreAccess(shop, key, now)).toBe(true);
    await setStoreClosure(f.db, shop, { mode: "password", password: "newpass" }, now);
    shop = await f.shop();
    expect(hasStoreAccess(shop, key, now)).toBe(false);

    // People who know the password can still buy, to try the store out.
    const [small] = await f.variants(f.products.lamp.id);
    await startCheckout(f.db, f.payments, shop, { email: "grace@example.com", address, lines: [{ variantId: small!.id, quantity: 1 }] });

    // On the opening day the store opens by itself.
    await setStoreClosure(f.db, shop, { mode: "password", password: "glow2026", until: "2026-11-01" }, now);
    shop = await f.shop();
    expect(activeClosure(shop, new Date("2026-10-31T23:59:00Z"))?.mode).toBe("password");
    expect(activeClosure(shop, new Date("2026-11-01T00:00:00Z"))).toBeNull();
    expect(hasStoreAccess(shop, undefined, new Date("2026-11-01T00:00:00Z"))).toBe(true);

    await setStoreClosure(f.db, shop, { mode: "open" }, now);
    expect((await f.shop()).closure).toBeNull();
  });

  it("takes no new orders on a holiday break, and reopens on the day set", async () => {
    const f = await makeFixture(new DemoModel());
    let shop = await f.shop();
    // With no date, the break lasts until the merchant opens the store again.
    await setStoreClosure(f.db, shop, { mode: "holiday", message: "Back from the beach soon!" }, now);
    shop = await f.shop();
    expect(shop.closure).toMatchObject({ mode: "holiday", passwordHash: null, accessKey: null });
    expect(onHoliday(shop)).toBe(true);
    // Anyone can look around.
    expect(hasStoreAccess(shop, undefined)).toBe(true);
    const [small] = await f.variants(f.products.lamp.id);
    await expect(startCheckout(f.db, f.payments, shop, { email: "grace@example.com", address, lines: [{ variantId: small!.id, quantity: 1 }] })).rejects.toThrow("on a break");

    await setStoreClosure(f.db, shop, { mode: "holiday", until: "2026-10-20" }, now);
    shop = await f.shop();
    expect(onHoliday(shop, now)).toBe(true);
    expect(onHoliday(shop, new Date("2026-10-20T00:00:00Z"))).toBe(false);

    // Switching from a password page to a break drops the password.
    await setStoreClosure(f.db, shop, { mode: "password", password: "glow2026" }, now);
    await setStoreClosure(f.db, await f.shop(), { mode: "holiday" }, now);
    shop = await f.shop();
    expect(shop.closure).toMatchObject({ mode: "holiday", until: null, passwordHash: null });
    // And back again needs a new one.
    await expect(setStoreClosure(f.db, shop, { mode: "password" }, now)).rejects.toThrow("Choose a password");

    await setStoreClosure(f.db, shop, { mode: "open" }, now);
    await startCheckout(f.db, f.payments, await f.shop(), { email: "grace@example.com", address, lines: [{ variantId: small!.id, quantity: 1 }] });
  });
});
