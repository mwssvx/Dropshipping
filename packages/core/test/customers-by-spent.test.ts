import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@sf/db";
import { customersCsv, customerTotals, DemoModel, listCustomers, saveView, spentParam, tagCustomers } from "../src";
import { makeFixture } from "../evals/fixture";

describe("customers by amount spent", () => {
  it("lists the customers who spent at least an amount, after refunds", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp } = f.products;
    // Sets an order's total, keeping the total check happy.
    const total = (id: string, totalMinor: number) =>
      f.db.update(schema.orders).set({ totalMinor, subtotalMinor: sql`${schema.orders.subtotalMinor} + ${totalMinor} - ${schema.orders.totalMinor}` }).where(eq(schema.orders.id, id));
    const small = await f.order(lamp.id);
    await total(small.id, 4000);
    const big = await f.order(lamp.id);
    await total(big.id, 30000);
    // Two orders that add up to more than $100.
    const many = await f.order(lamp.id);
    const manyAgain = await f.order(lamp.id);
    await total(many.id, 6000);
    await total(manyAgain.id, 6000);
    await f.db.update(schema.orders).set({ email: many.email }).where(eq(schema.orders.id, manyAgain.id));
    // Spent $300 but got $250 back.
    const refunded = await f.order(lamp.id);
    await total(refunded.id, 30000);
    await f.db.update(schema.orders).set({ refundedMinor: 25000, paymentStatus: "partially_refunded" }).where(eq(schema.orders.id, refunded.id));
    // A big order never paid for.
    const unpaid = await f.order(lamp.id);
    await total(unpaid.id, 90000);
    await f.db.update(schema.orders).set({ paymentStatus: "pending" }).where(eq(schema.orders.id, unpaid.id));

    const emails = async (minSpentMinor?: number) => (await listCustomers(f.db, shop.id, { minSpentMinor, limit: 1000 })).map((c) => c.email).sort();
    expect(await emails(10000)).toEqual([big.email, many.email].sort());
    expect(await emails(25000)).toEqual([big.email]);
    expect(await emails(5000)).toEqual([big.email, many.email, refunded.email].sort());
    expect(await emails(100000)).toEqual([]);
    expect((await customerTotals(f.db, shop.id, { minSpentMinor: 10000 })).customers).toBe(2);
    // The spreadsheet only narrows for staff who see money.
    expect((await customersCsv(f.db, shop.id, { minSpentMinor: 10000, money: true })).trim().split("\n")).toHaveLength(3);
    expect((await customersCsv(f.db, shop.id, { minSpentMinor: 10000, money: false })).trim().split("\n").length).toBeGreaterThan(3);
    expect((await tagCustomers(f.db, shop.id, { minSpentMinor: 10000 }, { tag: "vip" })).changed).toBe(2);
    expect((await listCustomers(f.db, shop.id, { tag: "vip" })).map((c) => c.email).sort()).toEqual([big.email, many.email].sort());
    expect((await saveView(f.db, shop.id, "customers", { name: "VIPs", params: { spent: "10000" } })).query).toBe("spent=10000");
    expect(spentParam("10000")).toBe(10000);
    expect(spentParam("123")).toBeUndefined();
    expect(spentParam(null)).toBeUndefined();
  });
});
