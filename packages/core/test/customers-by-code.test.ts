import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createDiscount, customersCsv, customerTotals, DemoModel, listCustomers, saveView, tagCustomers } from "../src";
import { makeFixture } from "../evals/fixture";

describe("customers who used a code", () => {
  it("lists the customers who paid for an order with a discount code", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp } = f.products;
    const code = await createDiscount(f.db, shop.id, { code: "ADA10", kind: "percent", value: 10 });
    const other = await createDiscount(f.db, shop.id, { code: "BOB5", kind: "percent", value: 5 });
    const used = await f.order(lamp.id);
    const plain = await f.order(lamp.id);
    const otherCode = await f.order(lamp.id);
    // Used the code once, then came back without it: still counts.
    const twice = await f.order(lamp.id);
    const twiceAgain = await f.order(lamp.id);
    // Tried the code but never paid: doesn't count.
    const unpaid = await f.order(lamp.id);
    await f.db.update(schema.orders).set({ discountId: code.id }).where(eq(schema.orders.id, used.id));
    await f.db.update(schema.orders).set({ discountId: other.id }).where(eq(schema.orders.id, otherCode.id));
    await f.db.update(schema.orders).set({ discountId: code.id }).where(eq(schema.orders.id, twice.id));
    await f.db.update(schema.orders).set({ email: twice.email }).where(eq(schema.orders.id, twiceAgain.id));
    await f.db.update(schema.orders).set({ discountId: code.id, paymentStatus: "pending" }).where(eq(schema.orders.id, unpaid.id));

    const emails = async (discountId?: string) => (await listCustomers(f.db, shop.id, { discountId, limit: 1000 })).map((c) => c.email).sort();
    expect(await emails(code.id)).toEqual([used.email, twice.email].sort());
    expect(await emails(other.id)).toEqual([otherCode.email]);
    expect(await emails()).toContain(plain.email);
    // Not an id: no filter.
    expect((await emails("ADA10")).length).toBe((await emails()).length);
    const row = (await listCustomers(f.db, shop.id, { discountId: code.id })).find((c) => c.email === twice.email)!;
    expect(row.orders).toBe(2);
    expect((await customerTotals(f.db, shop.id, { discountId: code.id })).customers).toBe(2);
    const csv = await customersCsv(f.db, shop.id, { discountId: code.id, money: true });
    expect(csv.trim().split("\n")).toHaveLength(3);
    expect(csv).not.toContain(plain.email);
    expect((await tagCustomers(f.db, shop.id, { discountId: code.id }, { tag: "ada" })).changed).toBe(2);
    expect((await listCustomers(f.db, shop.id, { tag: "ada" })).map((c) => c.email).sort()).toEqual([used.email, twice.email].sort());
    expect((await saveView(f.db, shop.id, "customers", { name: "Ada's fans", params: { code: code.id } })).query).toBe(`code=${code.id}`);
  });
});
