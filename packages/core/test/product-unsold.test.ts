import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, parseProductQuery, productPage, productUnsold, saveView } from "../src";
import { makeFixture } from "../evals/fixture";

const DAY = 86_400_000;

describe("products not sold lately", () => {
  it("lists products on sale with no paid order in 30 or 90 days, leaving out new ones", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, projector } = f.products;
    // Everything was added 100 days ago.
    await f.db.update(schema.products).set({ createdAt: new Date(Date.now() - 100 * DAY) }).where(eq(schema.products.shopId, shop.id));
    // The lamp sold today, the projector 60 days ago.
    await f.order(lamp.id);
    const old = await f.order(projector.id);
    await f.db.update(schema.orders).set({ paidAt: new Date(Date.now() - 60 * DAY) }).where(eq(schema.orders.id, old.id));
    const active = (await f.db.query.products.findMany({ where: and(eq(schema.products.shopId, shop.id), eq(schema.products.status, "active")) })).map((p) => p.title);

    const titles = async (unsold: string, status?: string) =>
      (await productPage(f.db, shop.id, parseProductQuery((k) => (k === "unsold" ? unsold : k === "status" ? status : undefined)))).products.map((p) => p.title).sort();
    const notLamp = active.filter((t) => t !== lamp.title).sort();
    const neither = notLamp.filter((t) => t !== projector.title);
    expect(await titles("30")).toEqual(notLamp);
    expect(await titles("90")).toEqual(neither);
    expect(await productUnsold(f.db, shop.id)).toEqual({ 30: notLamp.length, 90: neither.length });

    // A product added last week hasn't had 30 days yet.
    await f.db.update(schema.products).set({ createdAt: new Date(Date.now() - 7 * DAY) }).where(eq(schema.products.id, projector.id));
    expect(await titles("30")).toEqual(neither);
    // A refunded order is no sale.
    await f.db.update(schema.products).set({ createdAt: new Date(Date.now() - 100 * DAY) }).where(eq(schema.products.id, projector.id));
    await f.db.update(schema.orders).set({ paymentStatus: "refunded" }).where(eq(schema.orders.id, old.id));
    expect(await titles("90")).toEqual(notLamp);
    // Drafts and archived products are left out unless asked for.
    await f.db.update(schema.products).set({ status: "archived" }).where(eq(schema.products.id, projector.id));
    expect(await titles("90")).not.toContain(projector.title);
    expect(await titles("90", "archived")).toEqual([projector.title]);
    expect(parseProductQuery((k) => (k === "unsold" ? "7" : undefined)).unsold).toBeUndefined();
    expect((await saveView(f.db, shop.id, "products", { name: "Not selling", params: { unsold: "90" } })).query).toBe("unsold=90");
  });
});
