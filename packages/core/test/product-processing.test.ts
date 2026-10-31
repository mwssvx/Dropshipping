import { describe, expect, it } from "vitest";
import { cartDelivery, DemoModel, draftPolicies, exportStore, orderDelivery, processingFor, productDelivery, setDeliveryEstimates, setProductProcessingDays } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("preparing time per product", () => {
  it("counts a made-to-order product's own days in every delivery date", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const now = f.ctx.now!();
    const { lamp, projector } = f.products;
    await setDeliveryEstimates(f.db, shop.id, { enabled: true, processingDays: 2 });
    expect(processingFor({ processingDays: 2 }, [{ processingDays: null }, { processingDays: 5 }])).toBe(5);
    expect(processingFor({ processingDays: 2 }, [{ processingDays: 0 }])).toBe(0);
    expect(processingFor({ processingDays: 2 }, [])).toBe(2);

    await expect(setProductProcessingDays(f.db, shop.id, lamp.id, 31)).rejects.toThrow("Enter 0 to 30 days");
    await expect(setProductProcessingDays(f.db, shop.id, lamp.id, 1.5)).rejects.toThrow("Enter 0 to 30 days");
    expect(await setProductProcessingDays(f.db, shop.id, lamp.id, 7)).toEqual({ processingDays: 7 });

    // The demo supplier says 6 to 10 days in transit.
    const page = (await productDelivery(f.db, await f.shop(), lamp.id, { country: "US", now }))!;
    expect(page.processingDays).toBe(7);
    expect(page.from.getTime()).toBe(now.getTime() + 13 * DAY);
    expect((await productDelivery(f.db, await f.shop(), projector.id, { country: "US", now }))!.processingDays).toBe(2);

    // A cart waits for its slowest item.
    const [lampOption] = await f.variants(lamp.id);
    const [projectorOption] = await f.variants(projector.id);
    const cart = (await cartDelivery(f.db, await f.shop(), [{ variantId: lampOption!.id }, { variantId: projectorOption!.id }], { country: "US", now }))!;
    expect(cart.processingDays).toBe(7);
    const order = await f.order(lamp.id);
    expect((await orderDelivery(f.db, await f.shop(), order))!.from.getTime()).toBe(order.paidAt!.getTime() + 13 * DAY);

    // The shipping policy mentions slower items.
    expect((await draftPolicies(f.db, await f.shop())).find((p) => p.kind === "shipping")!.body).toContain("Some items are made to order and take longer to prepare.");
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.products.find((p: { handle: string }) => p.handle === lamp.handle).processing_days).toBe(7);

    // Back to the store's days.
    expect(await setProductProcessingDays(f.db, shop.id, lamp.id, null)).toEqual({ processingDays: null });
    expect((await productDelivery(f.db, await f.shop(), lamp.id, { country: "US", now }))!.processingDays).toBe(2);
    expect((await draftPolicies(f.db, await f.shop())).find((p) => p.kind === "shipping")!.body).not.toContain("made to order");
  });
});
