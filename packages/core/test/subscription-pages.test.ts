import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { countSubscriptions, DemoModel, listSubscriptions } from "../src";
import { makeFixture } from "../evals/fixture";

describe("subscription pages", () => {
  it("filters by status, finds failing charges, searches by email and pages", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [lamp] = await f.variants(f.products.lamp.id);
    const kinds = [
      { status: "active" as const },
      { status: "active" as const, failures: 1, lastError: "Card declined" },
      { status: "paused" as const, pausedBy: "buyer" as const },
      { status: "paused" as const, pausedBy: "payment" as const, failures: 3, lastError: "Card expired" },
      { status: "cancelled" as const },
    ];
    const made = [];
    for (const [i, kind] of kinds.entries()) {
      const order = await f.waitingOrder();
      const [row] = await f.db
        .insert(schema.subscriptions)
        .values({
          shopId: shop.id, email: `sub${i}@example.com`, token: `t${i}-${Date.now()}`, firstOrderId: order.id,
          lines: [{ variantId: lamp!.id, quantity: 1 }], shippingAddress: order.shippingAddress!, intervalDays: 30, percentOff: 10,
          nextOrderAt: new Date(), createdAt: new Date(Date.now() - (10 - i) * 60_000), ...kind,
        })
        .returning();
      made.push(row!);
    }
    const ids = async (filter: Parameters<typeof listSubscriptions>[2]) => (await listSubscriptions(f.db, shop.id, filter)).map((s) => s.email);

    expect(await ids({})).toEqual(["sub4@example.com", "sub3@example.com", "sub2@example.com", "sub1@example.com", "sub0@example.com"]);
    expect(await ids({ size: 2, page: 2 })).toEqual(["sub2@example.com", "sub1@example.com"]);
    expect(await ids({ status: "active" })).toEqual(["sub1@example.com", "sub0@example.com"]);
    expect(await ids({ status: "paused" })).toEqual(["sub3@example.com", "sub2@example.com"]);
    expect(await ids({ status: "failing" })).toEqual(["sub3@example.com", "sub1@example.com"]);
    expect(await ids({ query: "SUB2@" })).toEqual(["sub2@example.com"]);
    expect(await countSubscriptions(f.db, shop.id, {})).toBe(5);
    expect(await countSubscriptions(f.db, shop.id, { status: "failing" })).toBe(2);
    expect(await countSubscriptions(f.db, shop.id, { query: "nobody" })).toBe(0);
  });
});
