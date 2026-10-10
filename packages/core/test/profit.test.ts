import { describe, expect, it } from "vitest";
import { addAdSpend, DemoModel, deleteAdSpend, moneySummary, profitReport, profitWindow, refundOrder } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("profit report", () => {
  it("shows each product's profit after cost, fees, refunds and ads", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [lampV] = await f.variants(f.products.lamp.id);
    const one = await f.waitingOrder();
    // Shipped before the refund, so the supplier can't cancel it.
    const two = await f.shippedOrder();
    // The projector is out of stock at the supplier: no supplier cost was spent on it.
    const failed = await f.outOfStockOrder();
    await refundOrder(f.ctx, shop.id, two.id, {});

    const today = profitWindow(1).to;
    await addAdSpend(f.db, shop.id, { day: today, channel: "meta", amountMinor: 500, productId: f.products.lamp.id });
    await addAdSpend(f.db, shop.id, { day: today, channel: "google", amountMinor: 300 });

    const r = await profitReport(f.db, shop, 30);
    expect(r.orders).toBe(3);
    const lamp = r.products.find((p) => p.productId === f.products.lamp.id)!;
    const goods = (o: typeof one) => o.totalMinor - o.shippingMinor - o.taxMinor;
    expect(lamp.units).toBe(2);
    expect(lamp.salesMinor).toBe(goods(one) + goods(two));
    expect(lamp.refundsMinor).toBe(goods(two));
    // Both lamps were sent by the supplier, so both cost money even though one was refunded.
    expect(lamp.costMinor).toBe(2 * lampV!.costMinor!);
    // Our sales fee on the refunded order came back; the card fee didn't.
    expect(lamp.feesMinor).toBe(one.platformFeeMinor + one.processingFeeMinor + two.processingFeeMinor);
    expect(lamp.adsMinor).toBe(500);
    const beforeAds = goods(one) - lamp.costMinor - lamp.feesMinor;
    expect(lamp.profitMinor).toBe(beforeAds - 500);
    expect(lamp.roas).toBe(Math.round((goods(one) / 500) * 100) / 100);
    expect(lamp.breakEvenRoas).toBe(Math.round((goods(one) / beforeAds) * 100) / 100);

    const projector = r.products.find((p) => p.productId === f.products.projector.id)!;
    expect(projector.costMinor).toBe(0);
    expect(projector.salesMinor).toBe(goods(failed));

    // Spend not tied to a product only comes off the total.
    expect(r.untiedAdsMinor).toBe(300);
    expect(r.totals.adsMinor).toBe(800);
    expect(r.totals.profitMinor).toBe(lamp.profitMinor + projector.profitMinor - 300);
    expect(r.adsByChannel).toEqual([
      { channel: "meta", label: "Facebook and Instagram", amountMinor: 500 },
      { channel: "google", label: "Google", amountMinor: 300 },
    ]);
    expect((await moneySummary(f.db, shop)).last30).toMatchObject({ adsMinor: 800 });
  });

  it("checks what's entered, and leaves out older days", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const now = new Date();
    const day = (n: number) => new Date(now.getTime() - n * DAY).toISOString().slice(0, 10);
    await expect(addAdSpend(f.db, shop.id, { day: day(-1), channel: "meta", amountMinor: 100 })).rejects.toThrow("hasn't happened yet");
    await expect(addAdSpend(f.db, shop.id, { day: day(1), channel: "meta", amountMinor: 0 })).rejects.toThrow("how much you spent");
    await expect(addAdSpend(f.db, shop.id, { day: day(1), channel: "radio" as never, amountMinor: 100 })).rejects.toThrow("where the ads ran");
    const old = await addAdSpend(f.db, shop.id, { day: day(20), channel: "tiktok", amountMinor: 700 });
    await addAdSpend(f.db, shop.id, { day: day(2), channel: "tiktok", amountMinor: 200 });
    expect((await profitReport(f.db, shop, 7)).totals.adsMinor).toBe(200);
    expect((await profitReport(f.db, shop, 30)).totals.adsMinor).toBe(900);
    await deleteAdSpend(f.db, shop.id, old.id);
    expect((await profitReport(f.db, shop, 30)).totals).toMatchObject({ adsMinor: 200, profitMinor: -200, roas: 0 });
    await expect(deleteAdSpend(f.db, shop.id, old.id)).rejects.toThrow();
  });
});
