import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, type RETURN_REASONS } from "@sf/db";
import { DemoModel, returnsByProduct } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("returned most", () => {
  it("shows which products come back, out of how many sold, and why", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    expect(await returnsByProduct(f.db, shop.id)).toEqual({ days: 90, sold: 0, returned: 0, share: null, reasons: [], products: [] });

    const asked = async (order: { id: string }, reason: (typeof RETURN_REASONS)[number], status: "requested" | "refunded" | "declined" = "refunded") => {
      const [line] = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
      await f.db.insert(schema.returnRequests).values({ shopId: shop.id, orderId: order.id, reason, status, items: [{ lineId: line!.id, title: line!.title, quantity: line!.quantity }], suggestedMinor: 1000 });
    };
    const lamps = [];
    for (let i = 0; i < 6; i++) lamps.push(await f.waitingOrder());
    await asked(lamps[0]!, "too_small_or_big");
    await asked(lamps[1]!, "too_small_or_big", "requested");
    await asked(lamps[2]!, "changed_mind");
    // A declined return didn't come back.
    await asked(lamps[3]!, "damaged", "declined");
    // Too few galaxy projectors sold to say what share comes back.
    const projector = await f.outOfStockOrder();
    await asked(projector, "damaged");
    // A lamp paid four months ago only counts over the year.
    const old = await f.waitingOrder();
    await f.db.update(schema.orders).set({ paidAt: new Date(Date.now() - 120 * DAY) }).where(eq(schema.orders.id, old.id));
    await asked(old, "not_as_described");

    const report = await returnsByProduct(f.db, shop.id);
    expect(report).toMatchObject({ days: 90, sold: 7, returned: 4, share: 4 / 7 });
    expect(report.reasons).toEqual([
      { reason: "too_small_or_big", units: 2 },
      { reason: "damaged", units: 1 },
      { reason: "changed_mind", units: 1 },
    ]);
    expect(report.products).toEqual([
      {
        productId: f.products.lamp.id,
        title: "Sunset Projection Lamp",
        sold: 6,
        returned: 3,
        share: 0.5,
        high: true,
        reasons: [{ reason: "too_small_or_big", units: 2 }, { reason: "changed_mind", units: 1 }],
        fix: "Add a size chart or the measurements to the product page.",
      },
      { productId: f.products.projector.id, title: "Galaxy Projector", sold: 1, returned: 1, share: null, high: false, reasons: [{ reason: "damaged", units: 1 }], fix: "Ask the supplier to pack it better, or try another supplier." },
    ]);

    const year = await returnsByProduct(f.db, shop.id, { days: 365 });
    expect(year.products[0]).toMatchObject({ sold: 7, returned: 4, reasons: [{ reason: "too_small_or_big", units: 2 }, { reason: "not_as_described", units: 1 }, { reason: "changed_mind", units: 1 }] });
  });
});
