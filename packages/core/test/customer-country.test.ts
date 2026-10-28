import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { customerCountries, customersCsv, customerTotals, DemoModel, listCustomers, saveView, tagCustomers } from "../src";
import { makeFixture } from "../evals/fixture";

describe("customers by country", () => {
  it("lists the customers who bought for delivery to a country", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp } = f.products;
    const us = await f.order(lamp.id);
    const uk = await f.order(lamp.id, { country: "GB" });
    const both = await f.order(lamp.id);
    const bothUk = await f.order(lamp.id, { country: "GB" });
    await f.db.update(schema.orders).set({ email: both.email }).where(eq(schema.orders.id, bothUk.id));
    // An unpaid order doesn't count: one to Canada still waiting for payment.
    const ca = await f.order(lamp.id);
    await f.db.update(schema.orders).set({ paymentStatus: "pending", shippingAddress: { ...ca.shippingAddress, country: "CA" } }).where(eq(schema.orders.id, ca.id));

    const emails = async (country?: string) => (await listCustomers(f.db, shop.id, { country, limit: 1000 })).map((c) => c.email).sort();
    expect(await emails("GB")).toEqual([uk.email, both.email].sort());
    expect(await emails("gb")).toEqual([uk.email, both.email].sort());
    expect(await emails("US")).toEqual([us.email, both.email].sort());
    expect(await emails("CA")).toEqual([]);
    // Not a country: no filter.
    expect((await emails("Britain")).length).toBe((await emails()).length);
    // Each buyer counts once a country, unpaid orders not at all.
    expect(await customerCountries(f.db, shop.id)).toEqual([
      { country: "GB", count: 2 },
      { country: "US", count: 2 },
    ]);
    expect((await customerTotals(f.db, shop.id, { country: "GB" })).customers).toBe(2);
    const csv = await customersCsv(f.db, shop.id, { country: "GB", money: true });
    expect(csv.trim().split("\n")).toHaveLength(3);
    expect(csv).not.toContain(us.email);
    // Tag everyone in the UK list.
    expect((await tagCustomers(f.db, shop.id, { country: "GB" }, { tag: "uk" })).changed).toBe(2);
    expect((await listCustomers(f.db, shop.id, { tag: "uk" })).map((c) => c.email).sort()).toEqual([uk.email, both.email].sort());
    // A saved view keeps the country.
    expect((await saveView(f.db, shop.id, "customers", { name: "UK buyers", params: { country: "GB" } })).query).toBe("country=GB");
  });
});
