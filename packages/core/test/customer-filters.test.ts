import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { customersCsv, customerTotals, DemoModel, listCustomers, type CustomerFilter } from "../src";
import { makeFixture } from "../evals/fixture";

const DAY = 86_400_000;

describe("customer list filters", () => {
  it("show subscribers, repeat buyers, lapsed buyers and people who never bought", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const a = await f.order(f.products.lamp.id);
    const b = await f.order(f.products.lamp.id);
    const again = await f.order(f.products.lamp.id);
    // a buys twice; b's only order was long ago.
    await f.db.update(schema.orders).set({ email: a.email }).where(eq(schema.orders.id, again.id));
    await f.db.update(schema.orders).set({ paidAt: new Date(Date.now() - 120 * DAY) }).where(eq(schema.orders.id, b.id));
    await f.db.insert(schema.customers).values([
      { shopId: shop.id, email: "fan@example.com", name: "Fan", acceptsMarketing: true },
      { shopId: shop.id, email: "vip@example.com", name: "Vip", tags: ["vip"] },
    ]);
    const emails = async (filter: CustomerFilter, tag?: string) => (await listCustomers(f.db, shop.id, { filter, tag, limit: 1000 })).map((c) => c.email);

    expect(await emails("repeat")).toContain(a.email);
    expect(await emails("repeat")).not.toContain(b.email);
    expect(await emails("lapsed")).toContain(b.email);
    expect(await emails("lapsed")).not.toContain(a.email);
    expect(await emails("never")).toEqual(expect.arrayContaining(["fan@example.com", "vip@example.com"]));
    expect(await emails("never")).not.toContain(a.email);
    expect(await emails("subscribed")).toContain("fan@example.com");
    expect(await emails("subscribed")).not.toContain("vip@example.com");
    // Filters combine with tags, and the totals and download match the list.
    expect(await emails("never", "vip")).toEqual(["vip@example.com"]);
    for (const filter of ["repeat", "lapsed", "never", "subscribed"] as const) {
      expect((await customerTotals(f.db, shop.id, { filter })).customers).toBe((await emails(filter)).length);
    }
    const csv = await customersCsv(f.db, shop.id, { filter: "repeat", money: true });
    expect(csv.trim().split("\n")).toHaveLength(1 + (await emails("repeat")).length);
    expect(csv).toContain(a.email);
  });
});
