import { describe, expect, it } from "vitest";
import { countdownTo, createShop, createSale, DemoModel, exportStore, importStore, listSales, salesFor, signUp, storeWideCountdown } from "../src";
import { makeFixture } from "../evals/fixture";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("sale countdown", () => {
  it("counts down to a sale's real end, only in its last week and only when asked", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const now = new Date();
    await expect(createSale(f.db, shop.id, { title: "Forever", percentOff: 10, scope: "all", startsAt: now, countdown: true })).rejects.toThrow("A countdown needs an end time.");

    const ends = new Date(now.getTime() + 2 * DAY);
    const sale = await createSale(f.db, shop.id, { title: "Weekend sale", percentOff: 20, scope: "all", startsAt: now, endsAt: ends, countdown: true });
    expect(sale.countdown).toBe(true);
    const info = (await salesFor(f.db, shop.id, [f.products.lamp.id])).get(f.products.lamp.id)!;
    expect(countdownTo(info, now)).toEqual(ends);
    // Not more than a week out, not after the end, and not when the merchant didn't ask.
    expect(countdownTo({ ...info, endsAt: new Date(now.getTime() + 8 * DAY) }, now)).toBeNull();
    expect(countdownTo(info, new Date(ends.getTime() + 1))).toBeNull();
    expect(countdownTo({ ...info, countdown: false }, now)).toBeNull();

    expect(await storeWideCountdown(f.db, shop.id)).toEqual({ title: "Weekend sale", percentOff: 20, endsAt: ends });
    expect(await storeWideCountdown(f.db, shop.id, new Date(ends.getTime() + 1))).toBeNull();
  });

  it("puts only sales on everything in the store banner, the biggest first", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const now = new Date();
    const soon = new Date(now.getTime() + DAY);
    await createSale(f.db, shop.id, { title: "Lamps only", percentOff: 40, scope: "products", productIds: [f.products.lamp.id], startsAt: now, endsAt: soon, countdown: true });
    await createSale(f.db, shop.id, { title: "No clock", percentOff: 30, scope: "all", startsAt: now, endsAt: soon });
    expect(await storeWideCountdown(f.db, shop.id)).toBeNull();
    await createSale(f.db, shop.id, { title: "Small", percentOff: 5, scope: "all", startsAt: now, endsAt: soon, countdown: true });
    await createSale(f.db, shop.id, { title: "Big", percentOff: 15, scope: "all", startsAt: now, endsAt: soon, countdown: true });
    expect(await storeWideCountdown(f.db, shop.id)).toMatchObject({ title: "Big", percentOff: 15 });

    // The setting travels in the store file.
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.sales.find((s: { title: string }) => s.title === "Big").countdown).toBe(true);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    expect((await listSales(f.db, copy.id)).find((s) => s.title === "Big")).toMatchObject({ countdown: true });
    expect((await listSales(f.db, copy.id)).find((s) => s.title === "No clock")).toMatchObject({ countdown: false });
  });
});
