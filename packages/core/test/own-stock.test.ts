import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { addManualTracking, createProduct, DemoModel, editOrder, refundOrder, returnOrderStock, takeOrderStock } from "../src";
import { makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const mug = await createProduct(f.db, shop.id, {
    title: "Mug",
    status: "active",
    variants: [
      { title: "Blue", priceMinor: 1500, stock: 5 },
      { title: "Red", priceMinor: 1500, stock: 2 },
      { title: "Green", priceMinor: 1500 },
    ],
  });
  const mugVariants = await f.variants(mug.id);
  const stock = async () => Object.fromEntries((await f.variants(mug.id)).map((v) => [v.title, v.stock]));
  return { ...f, shopRow: shop, mug, mugVariants, stock };
}

describe("own stock", () => {
  it("comes off when a hand-added product's order is paid, once, and never below 0", async () => {
    const f = await setup();
    const o = await f.order(f.mug.id);
    expect(await f.stock()).toEqual({ Blue: 4, Red: 2, Green: null });
    expect(await takeOrderStock(f.db, o.id)).toBe(0);
    expect(await f.stock()).toMatchObject({ Blue: 4 });
    expect((await f.db.query.orders.findFirst({ where: eq(schema.orders.id, o.id) }))!.stockTakenAt).not.toBeNull();

    // Imported products follow the supplier's count instead.
    const [lampBefore] = await f.variants(f.products.lamp.id);
    await f.waitingOrder();
    const [lampAfter] = await f.variants(f.products.lamp.id);
    expect(lampAfter!.stock).toBe(lampBefore!.stock);

    await f.db.update(schema.variants).set({ stock: 1 }).where(eq(schema.variants.id, f.mugVariants[0]!.id));
    await f.db.update(schema.orderLines).set({ quantity: 3 }).where(eq(schema.orderLines.orderId, o.id));
    await returnOrderStock(f.db, o.id);
    expect(await f.stock()).toMatchObject({ Blue: 4 });
    await takeOrderStock(f.db, o.id);
    expect(await f.stock()).toMatchObject({ Blue: 1 });
    await f.db.update(schema.orders).set({ stockTakenAt: null }).where(eq(schema.orders.id, o.id));
    await takeOrderStock(f.db, o.id);
    await takeOrderStock(f.db, o.id);
    expect(await f.stock()).toMatchObject({ Blue: 0 });
  });

  it("goes back when the order is refunded before it ships, but not after", async () => {
    const f = await setup();
    const kept = await f.order(f.mug.id);
    const returned = await f.order(f.mug.id);
    expect(await f.stock()).toMatchObject({ Blue: 3 });

    await refundOrder(f.ctx, f.shopRow.id, returned.id, { amountMinor: 100 });
    expect(await f.stock()).toMatchObject({ Blue: 3 });
    await refundOrder(f.ctx, f.shopRow.id, returned.id, {});
    expect(await f.stock()).toMatchObject({ Blue: 4 });

    await addManualTracking(f.ctx, f.shopRow.id, kept.id, { carrier: "USPS", trackingNumber: "9400111899223100001234" });
    await refundOrder(f.ctx, f.shopRow.id, kept.id, {});
    expect(await f.stock()).toMatchObject({ Blue: 4 });
  });

  it("follows a swap to another option before it ships", async () => {
    const f = await setup();
    const o = await f.order(f.mug.id);
    const line = (await f.db.query.orderLines.findFirst({ where: eq(schema.orderLines.orderId, o.id) }))!;
    await editOrder(f.ctx, f.shopRow.id, o.id, { lines: { [line.id]: f.mugVariants[1]!.id } }, "merchant");
    expect(await f.stock()).toEqual({ Blue: 5, Red: 1, Green: null });
    await editOrder(f.ctx, f.shopRow.id, o.id, { lines: { [line.id]: f.mugVariants[2]!.id } }, "merchant");
    expect(await f.stock()).toEqual({ Blue: 5, Red: 2, Green: null });
  });
});
