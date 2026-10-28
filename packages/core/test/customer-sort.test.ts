import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, listCustomers, type CustomerSort } from "../src";
import { makeFixture } from "../evals/fixture";

describe("customer list sort", () => {
  it("orders by last order, money spent, order count, join date and name", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const a = await f.order(f.products.lamp.id);
    await f.order(f.products.lamp.id);
    const third = await f.order(f.products.lamp.id);
    // The first buyer comes back, so they have two orders and spent the most.
    await f.db.update(schema.orders).set({ email: a.email }).where(eq(schema.orders.id, third.id));
    await f.db.insert(schema.customers).values([
      { shopId: shop.id, email: "zed@example.com", name: "zed", tags: ["vip"] },
      { shopId: shop.id, email: "amy@example.com", name: "Amy", tags: ["vip"] },
    ]);
    const list = (sort?: CustomerSort) => listCustomers(f.db, shop.id, { sort, limit: 1000 });
    const pairs = <T,>(xs: T[]) => xs.slice(1).map((x, i) => [xs[i]!, x] as const);

    const spent = await list("spent");
    expect(spent[0]!.email).toBe(a.email);
    expect(pairs(spent).every(([x, y]) => x.spentMinor >= y.spentMinor)).toBe(true);
    const orders = await list("orders");
    expect(orders[0]).toMatchObject({ email: a.email, orders: 2 });
    expect(pairs(orders).every(([x, y]) => x.orders >= y.orders)).toBe(true);
    const newest = await list("newest");
    expect(pairs(newest).every(([x, y]) => x.createdAt >= y.createdAt)).toBe(true);
    // Names ignore case, and customers without one come last.
    const named = (await list("name")).filter((c) => c.name);
    expect(named.map((c) => c.name!.toLowerCase())).toEqual(named.map((c) => c.name!.toLowerCase()).sort());
    const byName = await list("name");
    expect(byName.slice(named.length).every((c) => !c.name)).toBe(true);
    // The default is the last order: people who never ordered go last.
    const recent = await list();
    expect(recent.slice(-2).map((c) => c.lastOrderAt)).toEqual([null, null]);
    expect(pairs(recent.filter((c) => c.lastOrderAt)).every(([x, y]) => x.lastOrderAt! >= y.lastOrderAt!)).toBe(true);
    // Sort and paging work together.
    expect((await listCustomers(f.db, shop.id, { sort: "spent", limit: 1, offset: 0 }))[0]!.email).toBe(a.email);
    expect((await listCustomers(f.db, shop.id, { sort: "name", tag: "vip" })).map((c) => c.name)).toEqual(["Amy", "zed"]);
  });
});
