import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { DemoModel, gradeSupplier, SCORE_MIN_ORDERS, supplierScorecard } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("supplier scorecard", () => {
  it("grades on the worst measure, and not on too few orders", () => {
    const base = { orders: 20, failedRate: 0, problemRate: 0, shipDays: 2 };
    expect(gradeSupplier(base)).toBe("good");
    expect(gradeSupplier({ ...base, shipDays: 5 })).toBe("watch");
    expect(gradeSupplier({ ...base, problemRate: 3 })).toBe("watch");
    expect(gradeSupplier({ ...base, failedRate: 12 })).toBe("poor");
    expect(gradeSupplier({ ...base, shipDays: 9 })).toBe("poor");
    expect(gradeSupplier({ ...base, orders: SCORE_MIN_ORDERS - 1, failedRate: 50 })).toBe("too_few");
  });

  it("counts failures, shipping speed, late orders and problems for each supplier", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const now = () => f.ctx.now!();
    expect(await supplierScorecard(f.db, shopId, { now: now() })).toEqual([]);

    // Four shipped, one the supplier couldn't take, one still waiting.
    const shipped = [await f.shippedOrder(), await f.shippedOrder(), await f.shippedOrder(), await f.shippedOrder()];
    await f.outOfStockOrder();
    await f.waitingOrder();
    // One of the shipped ones arrived broken.
    await f.db.insert(schema.returnRequests).values({
      shopId,
      orderId: shipped[0]!.id,
      reason: "damaged",
      items: [],
      suggestedMinor: 0,
    });
    // A buyer who changed their mind isn't the supplier's fault.
    await f.db.insert(schema.returnRequests).values({ shopId, orderId: shipped[1]!.id, reason: "changed_mind", items: [], suggestedMinor: 0 });

    let [card] = await supplierScorecard(f.db, shopId, { now: now() });
    expect(card).toMatchObject({
      supplier: { provider: "fake" },
      orders: 6,
      failed: 1,
      failedRate: 16.7,
      shipped: 4,
      problems: 1,
      problemRate: 25,
      late: 0,
      grade: "poor",
    });
    expect(card!.shipDays).toBeGreaterThan(0);
    // Every active product from it could use a backup.
    expect(card!.productsWithoutBackup).toBe(2);

    // A week later the waiting one is late.
    f.advance(8 * DAY);
    [card] = await supplierScorecard(f.db, shopId, { now: now() });
    expect(card!.late).toBe(1);

    // Outside the window, nothing counts.
    expect(await supplierScorecard(f.db, shopId, { now: now(), days: 1 })).toEqual([]);
  });
});
