import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { countOpenReturns, countReturns, DemoModel, listReturns } from "../src";
import { makeFixture } from "../evals/fixture";

describe("return pages", () => {
  it("never hides an open return behind newer answered ones, and pages and searches the answered", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const orders: Awaited<ReturnType<typeof f.shippedOrder>>[] = [];
    for (let i = 0; i < 4; i++) orders.push(await f.shippedOrder());
    const row = (i: number, status: "requested" | "approved" | "refunded" | "declined", minutesAgo: number) => ({
      shopId: shop.id, orderId: orders[i]!.id, status, reason: "damaged" as const, items: [], suggestedMinor: 1000,
      createdAt: new Date(Date.now() - minutesAgo * 60_000),
    });
    // An old return still waiting, then three newer answered ones.
    await f.db.insert(schema.returnRequests).values([row(0, "requested", 100), row(1, "refunded", 30), row(2, "declined", 20), row(3, "refunded", 10)]);

    expect((await listReturns(f.db, shop.id, "open")).map((r) => r.orderNumber)).toEqual([orders[0]!.number]);
    expect(await countOpenReturns(f.db, shop.id)).toBe(1);
    const answered = (opts: Parameters<typeof listReturns>[3]) => listReturns(f.db, shop.id, "answered", opts).then((rs) => rs.map((r) => r.orderNumber));
    expect(await answered({ size: 2 })).toEqual([orders[3]!.number, orders[2]!.number]);
    expect(await answered({ size: 2, page: 2 })).toEqual([orders[1]!.number]);
    expect(await countReturns(f.db, shop.id, "answered")).toBe(3);
    expect(await answered({ query: `#${orders[2]!.number}` })).toEqual([orders[2]!.number]);
    expect(await answered({ query: orders[1]!.email.toUpperCase() })).toContain(orders[1]!.number);
    expect(await countReturns(f.db, shop.id, "answered", "nobody@nowhere")).toBe(0);
  });
});
