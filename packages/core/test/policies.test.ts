import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { addPolicyPages, createPage, createShippingZone, addShippingRate, DemoModel, draftPolicies } from "../src";
import { makeFixture } from "../evals/fixture";

describe("store policies", () => {
  it("drafts pages from the store's own settings", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await f.db.update(schema.shops).set({ returnWindowDays: 14, processingDays: 3, invoiceLegalName: "Lamp Co Ltd", adPixels: { meta: "123", tiktok: null, google: null } }).where(eq(schema.shops.id, shop.id));
    const drafts = await draftPolicies(f.db, await f.shop());
    const body = (k: string) => drafts.find((d) => d.kind === k)!.body;
    expect(drafts.map((d) => d.title)).toEqual(["Returns and refunds", "Shipping", "Privacy policy", "Terms of service"]);
    expect(body("returns")).toContain("within 14 days of delivery");
    expect(body("returns")).toContain("cancel from your order page");
    expect(body("shipping")).toContain("within 3 business days");
    expect(body("shipping")).toMatch(/Everywhere we ship: Standard, \$[\d.]+/);
    expect(body("privacy")).toContain("advertising tags");
    expect(body("terms")).toContain("run by Lamp Co Ltd");

    await f.db.update(schema.shops).set({ returnWindowDays: 0, adPixels: null }).where(eq(schema.shops.id, shop.id));
    const off = await draftPolicies(f.db, await f.shop());
    expect(off.find((d) => d.kind === "returns")!.body).toContain("We don't take returns on change of mind");
    expect(off.find((d) => d.kind === "privacy")!.body).not.toContain("advertising tags");
  });

  it("lists each zone's rates and times", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const zone = await createShippingZone(f.db, shop.id, { name: "UK", countries: ["GB"] });
    await addShippingRate(f.db, shop.id, zone.id, { name: "Royal Mail", priceMinor: 395, freeOverMinor: 5000, minDays: 2, maxDays: 4 });
    const shipping = (await draftPolicies(f.db, shop)).find((d) => d.kind === "shipping")!.body;
    expect(shipping).toContain("United Kingdom: Royal Mail, $3.95, free on orders over $50.00, usually 2 to 4 business days.");
  });

  it("adds the chosen pages and never replaces one the store wrote", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await createPage(f.db, shop.id, { title: "Our returns", handle: "returns", body: "Write to us." });
    await expect(addPolicyPages(f.db, shop, [])).rejects.toThrow("Pick at least one");
    const created = await addPolicyPages(f.db, shop, ["returns", "shipping", "privacy", "nonsense"]);
    expect(created.map((p) => p.handle)).toEqual(["shipping", "privacy"]);
    const returns = await f.db.query.pages.findFirst({ where: eq(schema.pages.handle, "returns") });
    expect(returns!.body).toBe("Write to us.");
    expect((await draftPolicies(f.db, shop)).filter((d) => d.existingId).map((d) => d.kind)).toEqual(["returns", "shipping", "privacy"]);
    expect(await addPolicyPages(f.db, shop, ["shipping"])).toEqual([]);
  });
});
