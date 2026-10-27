import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, homeCounts } from "../src";
import { makeFixture } from "../evals/fixture";

describe("home page counts", () => {
  it("counts paid orders, today's sales and what needs the merchant without loading them", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const before = await homeCounts(f.db, shop.id, new Date(Date.now() - 60_000));
    const a = await f.waitingOrder();
    const b = await f.waitingOrder();
    const c = await f.waitingOrder();
    await f.db.update(schema.orders).set({ fulfillmentStatus: "unfulfilled", heldAt: new Date() }).where(eq(schema.orders.id, a.id));
    await f.db.update(schema.orders).set({ fulfillmentStatus: "unfulfilled" }).where(eq(schema.orders.id, b.id));
    await f.db.update(schema.orders).set({ fulfillmentStatus: "problem", paidAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(schema.orders.id, c.id));
    // Not paid, so not counted.
    const pending = await f.waitingOrder();
    await f.db.update(schema.orders).set({ paymentStatus: "pending", fulfillmentStatus: "unfulfilled" }).where(eq(schema.orders.id, pending.id));

    const counts = await homeCounts(f.db, shop.id, new Date(Date.now() - 86_400_000));
    expect(counts).toMatchObject({ paid: before.paid + 3, held: before.held + 1, toSend: before.toSend + 1, problems: before.problems + 1 });
    expect(counts.today).toBe(before.today + 2);
    expect(counts.todayMinor).toBe(before.todayMinor + a.totalMinor + b.totalMinor);
    expect(counts.products).toBeGreaterThan(0);
    expect(counts.activeProducts).toBeGreaterThan(0);
  });
});
