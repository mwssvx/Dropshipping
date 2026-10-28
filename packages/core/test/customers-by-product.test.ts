import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { customersCsv, customerTotals, DemoModel, listCustomers, saveView, tagCustomers } from "../src";
import { makeFixture } from "../evals/fixture";

describe("customers who bought a product", () => {
  it("lists the customers who paid for an order with the product in it", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, projector: stand } = f.products;
    const lampBuyer = await f.order(lamp.id);
    const standBuyer = await f.order(stand.id);
    // Bought the lamp once, then a stand: still a lamp buyer.
    const both = await f.order(lamp.id);
    const bothAgain = await f.order(stand.id);
    await f.db.update(schema.orders).set({ email: both.email }).where(eq(schema.orders.id, bothAgain.id));
    // Put the lamp in an order but never paid: doesn't count.
    const unpaid = await f.order(lamp.id);
    await f.db.update(schema.orders).set({ paymentStatus: "pending" }).where(eq(schema.orders.id, unpaid.id));

    const emails = async (productId?: string) => (await listCustomers(f.db, shop.id, { productId, limit: 1000 })).map((c) => c.email).sort();
    expect(await emails(lamp.id)).toEqual([lampBuyer.email, both.email].sort());
    expect(await emails(stand.id)).toEqual([standBuyer.email, both.email].sort());
    // Not an id: no filter.
    expect((await emails("lamp")).length).toBe((await emails()).length);
    const row = (await listCustomers(f.db, shop.id, { productId: lamp.id })).find((c) => c.email === both.email)!;
    expect(row.orders).toBe(2);
    expect((await customerTotals(f.db, shop.id, { productId: lamp.id })).customers).toBe(2);
    const csv = await customersCsv(f.db, shop.id, { productId: lamp.id, money: true });
    expect(csv.trim().split("\n")).toHaveLength(3);
    expect(csv).not.toContain(standBuyer.email);
    expect((await tagCustomers(f.db, shop.id, { productId: lamp.id }, { tag: "lamp" })).changed).toBe(2);
    expect((await listCustomers(f.db, shop.id, { tag: "lamp" })).map((c) => c.email).sort()).toEqual([lampBuyer.email, both.email].sort());
    expect((await saveView(f.db, shop.id, "customers", { name: "Lamp owners", params: { product: lamp.id } })).query).toBe(`product=${lamp.id}`);
  });
});
