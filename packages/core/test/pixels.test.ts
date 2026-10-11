import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, exportStore, importStore, needsConsent, setAdPixels, storePixels } from "../src";
import { makeFixture } from "../evals/fixture";

describe("ad tracking", () => {
  it("only takes IDs in each platform's format", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const consent = "everyone" as const;
    await expect(setAdPixels(f.db, shopId, { meta: "12345", consent })).rejects.toThrow("10 to 20 digits");
    await expect(setAdPixels(f.db, shopId, { meta: "123456789012345');alert(1)//", consent })).rejects.toThrow("10 to 20 digits");
    await expect(setAdPixels(f.db, shopId, { tiktok: "short", consent })).rejects.toThrow("TikTok pixel ID");
    await expect(setAdPixels(f.db, shopId, { google: "UA-1234-1", consent })).rejects.toThrow("starts with G-");
    // Spaces from copying and lower case are forgiven.
    expect(await setAdPixels(f.db, shopId, { meta: " 1234567890123456 ", tiktok: "cabc123def456ghi789jk", google: "g-abc123def4", consent: "eu_uk" })).toEqual({
      meta: "1234567890123456",
      tiktok: "CABC123DEF456GHI789JK",
      google: "G-ABC123DEF4",
    });
    const shop = await f.shop();
    expect(shop.cookieConsent).toBe("eu_uk");
    expect(storePixels(shop)).toEqual(shop.adPixels);
    // All empty turns tracking off.
    expect(await setAdPixels(f.db, shopId, { meta: "", tiktok: null, consent })).toBeNull();
    expect(storePixels(await f.shop())).toBeNull();
  });

  it("never hands a bad value to the page", () => {
    expect(storePixels({ adPixels: { meta: "<script>", tiktok: null, google: "G-ABC123DEF4" } })).toEqual({ meta: null, tiktok: null, google: "G-ABC123DEF4" });
    expect(storePixels({ adPixels: { meta: "x", tiktok: "y", google: "z" } })).toBeNull();
  });

  it("asks EU, EEA and UK visitors, or everyone", () => {
    const eu = { cookieConsent: "eu_uk" as const };
    expect(needsConsent(eu, "DE")).toBe(true);
    expect(needsConsent(eu, "gb")).toBe(true);
    expect(needsConsent(eu, "NO")).toBe(true);
    expect(needsConsent(eu, "US")).toBe(false);
    // Not knowing where they are means asking.
    expect(needsConsent(eu, null)).toBe(true);
    expect(needsConsent({ cookieConsent: "everyone" }, "US")).toBe(true);
  });

  it("comes along in a store export", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await setAdPixels(f.db, shop.id, { meta: "1234567890123456", google: "AW-123456789", consent: "eu_uk" });
    const data = await exportStore(f.db, shop.id);
    expect(data.store.ad_tracking).toEqual({ meta_pixel: "1234567890123456", tiktok_pixel: null, google_tag: "AW-123456789", ask_consent: "eu_uk" });
    const g = await makeFixture(new DemoModel());
    const target = await g.shop();
    await g.db.delete(schema.products).where(eq(schema.products.shopId, target.id));
    await importStore(g.db, target.id, { ...data, store: { ...data.store, ad_tracking: { ...data.store.ad_tracking!, tiktok_pixel: "not an id" } } });
    const copy = await g.shop();
    expect(copy.adPixels).toEqual({ meta: "1234567890123456", tiktok: null, google: "AW-123456789" });
    expect(copy.cookieConsent).toBe("eu_uk");
  });
});
