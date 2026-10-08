import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@sf/db";
import {
  addDomain,
  checkDomain,
  collectionProducts,
  createCollection,
  createPage,
  createProduct,
  createShop,
  defaultTheme,
  discardThemeDraft,
  dnsRecordsFor,
  DnsDomainHost,
  getCollectionByHandle,
  getPublishedPageByHandle,
  getPublishedTheme,
  getShopByHostname,
  getTheme,
  isSafeLink,
  listCollections,
  normalizeHostname,
  paragraphs,
  parseTheme,
  primaryDomain,
  publishTheme,
  removeDomain,
  saveThemeDraft,
  setPrimaryDomain,
  signUp,
  updateCollection,
  updatePage,
  UserError,
  type DomainCheck,
  type DomainContext,
  type DomainHost,
} from "../src";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

async function shopWithProducts() {
  const user = await signUp(db, { email: "owner@example.com", password: "correct horse" });
  const shop = await createShop(db, user.id, { name: "Glow Lamps", country: "US" });
  const mk = (title: string, status: "active" | "draft" = "active") =>
    createProduct(db, shop.id, { title, status, variants: [{ title: "Default", priceMinor: 2500 }] });
  const lamp = await mk("Sunset Lamp");
  const stand = await mk("Phone Stand");
  const hidden = await mk("Secret Draft", "draft");
  return { user, shop, lamp, stand, hidden };
}

describe("themes", () => {
  it("starts from a default theme and only shows edits after publishing", async () => {
    const { shop } = await shopWithProducts();
    const first = await getTheme(db, shop);
    expect(first.hasChanges).toBe(false);
    expect(first.published.home.some((s) => s.type === "hero")).toBe(true);

    const draft = structuredClone(first.draft);
    const hero = draft.home.find((s) => s.type === "hero")!;
    if (hero.type === "hero") hero.settings.heading = "Lamps that glow";
    await saveThemeDraft(db, shop, draft);

    const live = await getPublishedTheme(db, shop);
    expect(JSON.stringify(live)).not.toContain("Lamps that glow");
    expect((await getTheme(db, shop)).hasChanges).toBe(true);

    await publishTheme(db, shop);
    expect(JSON.stringify(await getPublishedTheme(db, shop))).toContain("Lamps that glow");
    expect((await getTheme(db, shop)).hasChanges).toBe(false);
  });

  it("discarding the draft goes back to what is live", async () => {
    const { shop } = await shopWithProducts();
    const { draft } = await getTheme(db, shop);
    draft.settings.colors.accent = "#ff0000";
    await saveThemeDraft(db, shop, draft);
    await discardThemeDraft(db, shop);
    const after = await getTheme(db, shop);
    expect(after.draft.settings.colors.accent).not.toBe("#ff0000");
    expect(after.hasChanges).toBe(false);
  });

  it("rejects unsafe links, bad colors and unknown sections", () => {
    const base = defaultTheme("Glow");
    const withLink = (href: string) => ({ ...base, menus: { ...base.menus, header: [{ label: "x", href }] } });
    expect(() => parseTheme(withLink("javascript:alert(1)"))).toThrow(UserError);
    expect(() => parseTheme(withLink("//evil.example.com"))).toThrow(UserError);
    expect(() => parseTheme(withLink("/pages/about"))).not.toThrow();
    expect(() => parseTheme({ ...base, settings: { ...base.settings, colors: { ...base.settings.colors, text: "red" } } })).toThrow(
      /#1a2b3c/,
    );
    expect(() => parseTheme({ ...base, home: [{ id: "abcd1234", type: "script", settings: {} }] })).toThrow(UserError);
    const hero = base.home.find((s) => s.type === "hero")!;
    expect(() => parseTheme({ ...base, home: [hero, hero] })).toThrow(/share an id/);
    expect(isSafeLink("mailto:hi@example.com")).toBe(true);
  });

  it("a stored theme that no longer validates falls back to the default", async () => {
    const { shop } = await shopWithProducts();
    await getTheme(db, shop);
    const { schema } = await import("@sf/db");
    await db.update(schema.themes).set({ published: { nonsense: true } });
    const live = await getPublishedTheme(db, shop);
    expect(live.home.length).toBeGreaterThan(0);
  });
});

describe("collections", () => {
  it("keeps the merchant's order and hides draft products from buyers", async () => {
    const { shop, lamp, stand, hidden } = await shopWithProducts();
    const c = await createCollection(db, shop.id, { title: "Best sellers", productIds: [stand.id, hidden.id, lamp.id] });
    expect(c.handle).toBe("best-sellers");
    const { products } = await getCollectionByHandle(db, shop.id, "best-sellers");
    expect(products.map((p) => p.title)).toEqual(["Phone Stand", "Sunset Lamp"]);
    expect((await listCollections(db, shop.id))[0]!.productCount).toBe(3);

    await updateCollection(db, shop.id, c.id, { title: "Best sellers", productIds: [lamp.id] });
    expect((await collectionProducts(db, shop.id, c.id)).map((p) => p.title)).toEqual(["Sunset Lamp"]);
  });

  it("'all' lists every active product and can't be taken as a handle", async () => {
    const { shop } = await shopWithProducts();
    const all = await getCollectionByHandle(db, shop.id, "all");
    expect(all.products).toHaveLength(2);
    const c = await createCollection(db, shop.id, { title: "All" });
    expect(c.handle).toBe("all-2");
  });

  it("refuses products from another store", async () => {
    const { shop } = await shopWithProducts();
    const other = await createShop(db, (await signUp(db, { email: "b@example.com", password: "correct horse" })).id, {
      name: "Other",
      country: "US",
    });
    const foreign = await createProduct(db, other.id, { title: "Theirs", variants: [{ priceMinor: 100 }] });
    await expect(createCollection(db, shop.id, { title: "Mixed", productIds: [foreign.id] })).rejects.toThrow(/isn't in this store/);
  });
});

describe("pages", () => {
  it("creates pages with readable addresses and hides unpublished ones", async () => {
    const { shop } = await shopWithProducts();
    const p = await createPage(db, shop.id, { title: "Shipping & Returns", body: "We ship fast.\n\nReturns within 30 days." });
    expect(p.handle).toBe("shipping-returns");
    expect(paragraphs(p.body)).toEqual(["We ship fast.", "Returns within 30 days."]);
    await expect(createPage(db, shop.id, { title: "Other", handle: "shipping-returns" })).rejects.toThrow(/already uses/);
    await updatePage(db, shop.id, p.id, { title: p.title, handle: p.handle, body: p.body, published: false });
    await expect(getPublishedPageByHandle(db, shop.id, "shipping-returns")).rejects.toThrow(/not found/);
  });
});

class StubHost implements DomainHost {
  readonly name = "stub";
  attached: string[] = [];
  result: DomainCheck = { ok: false, problem: "not yet" };
  async attach(h: string) {
    this.attached.push(h);
  }
  async detach(h: string) {
    this.attached = this.attached.filter((x) => x !== h);
  }
  async check() {
    return this.result;
  }
}

describe("custom domains", () => {
  it("normalizes what merchants type and refuses platform addresses", () => {
    expect(normalizeHostname(" https://Shop.Example.com/products?x=1 ")).toBe("shop.example.com");
    expect(normalizeHostname("example.co.uk.")).toBe("example.co.uk");
    expect(() => normalizeHostname("not a domain")).toThrow(UserError);
    expect(() => normalizeHostname("glow.storefront.com", ["storefront.com"])).toThrow(/belongs to the platform/);
    expect(() => normalizeHostname("my-store.vercel.app")).toThrow(/belongs to the platform/);
  });

  it("tells merchants which DNS record to add", () => {
    expect(dnsRecordsFor("example.com")).toEqual([{ type: "A", name: "@", value: "76.76.21.21" }]);
    expect(dnsRecordsFor("example.co.uk")[0]!.type).toBe("A");
    expect(dnsRecordsFor("shop.example.com")).toEqual([{ type: "CNAME", name: "shop", value: "cname.vercel-dns.com" }]);
    expect(dnsRecordsFor("www.shop.example.co.uk")[0]!.name).toBe("www.shop");
  });

  it("serves a domain only after its DNS checks out, and the first one becomes primary", async () => {
    const { shop } = await shopWithProducts();
    const host = new StubHost();
    const ctx: DomainContext = { db, host, platformHosts: ["storefront.com"] };
    const d = await addDomain(ctx, shop.id, "glowlamps.com");
    expect(host.attached).toEqual(["glowlamps.com"]);
    expect(await getShopByHostname(db, "glowlamps.com")).toBeNull();

    const failed = await checkDomain(ctx, shop.id, d.id);
    expect(failed.lastError).toBe("not yet");
    await expect(setPrimaryDomain(db, shop.id, d.id)).rejects.toThrow(/Finish connecting/);

    host.result = { ok: true };
    const ok = await checkDomain(ctx, shop.id, d.id);
    expect(ok.verifiedAt).toBeTruthy();
    expect(ok.isPrimary).toBe(true);
    expect((await getShopByHostname(db, "GlowLamps.com:443"))?.id).toBe(shop.id);
    expect(await primaryDomain(db, shop.id)).toBe("glowlamps.com");

    const www = await addDomain(ctx, shop.id, "www.glowlamps.com");
    await checkDomain(ctx, shop.id, www.id);
    await setPrimaryDomain(db, shop.id, www.id);
    expect(await primaryDomain(db, shop.id)).toBe("www.glowlamps.com");

    await removeDomain(ctx, shop.id, www.id);
    expect(await primaryDomain(db, shop.id)).toBe("glowlamps.com");
    expect(host.attached).toEqual(["glowlamps.com"]);
  });

  it("one domain can't belong to two stores", async () => {
    const { shop } = await shopWithProducts();
    const other = await createShop(db, (await signUp(db, { email: "b@example.com", password: "correct horse" })).id, {
      name: "Other",
      country: "US",
    });
    const ctx: DomainContext = { db, host: new StubHost(), platformHosts: [] };
    await addDomain(ctx, shop.id, "glowlamps.com");
    await expect(addDomain(ctx, other.id, "glowlamps.com")).rejects.toThrow(/another store/);
    await expect(addDomain(ctx, shop.id, "glowlamps.com")).rejects.toThrow(/already on your list/);
  });

  it("the DNS checker accepts the CNAME or the A record", async () => {
    const lookup = {
      resolveCname: async (h: string) => (h === "shop.example.com" ? ["cname.vercel-dns.com."] : []),
      resolve4: async (h: string) => (h === "example.com" ? ["76.76.21.21"] : h === "wrong.com" ? ["1.2.3.4"] : []),
    };
    const dns = new DnsDomainHost(undefined, lookup as never);
    expect(await dns.check("shop.example.com")).toEqual({ ok: true });
    expect(await dns.check("example.com")).toEqual({ ok: true });
    expect(await dns.check("wrong.com")).toMatchObject({ ok: false, problem: expect.stringContaining("1.2.3.4") });
    expect(await dns.check("nothing.com")).toMatchObject({ ok: false, problem: expect.stringContaining("can't find") });
  });
});
