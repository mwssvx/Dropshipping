import { describe, expect, it } from "vitest";
import { countOrders, DemoModel, listOrders, orderCountries, orderPage, ordersCsv } from "../src";
import { makeFixture } from "../evals/fixture";

describe("order list filters", () => {
  it("find orders with a product, or shipping to a country", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const lampUS = await f.order(f.products.lamp.id);
    const lampGB = await f.order(f.products.lamp.id, { country: "GB" });
    const projector = await f.order(f.products.projector.id, { country: "GB" });
    const numbers = async (filter: Parameters<typeof listOrders>[2]) => (await listOrders(f.db, shop.id, filter)).map((o) => o.number);

    const lamp = await numbers({ productId: f.products.lamp.id });
    expect(lamp).toEqual(expect.arrayContaining([lampUS.number, lampGB.number]));
    expect(lamp).not.toContain(projector.number);
    expect(await numbers({ productId: f.products.projector.id })).toContain(projector.number);
    expect(await numbers({ productId: f.products.projector.id })).not.toContain(lampGB.number);

    const gb = await numbers({ country: "gb" });
    expect(gb).toEqual(expect.arrayContaining([lampGB.number, projector.number]));
    expect(gb).not.toContain(lampUS.number);
    expect(await numbers({ country: "GB", productId: f.products.lamp.id })).toEqual([lampGB.number]);
    // Nonsense is ignored, not an error.
    expect((await numbers({ productId: "not-an-id", country: "Britain" })).length).toBe((await listOrders(f.db, shop.id)).length);

    // The page, counts and download use the same filter.
    expect((await orderPage(f.db, shop.id, { country: "GB", productId: f.products.lamp.id })).orders.map((o) => o.number)).toEqual([lampGB.number]);
    expect(await countOrders(f.db, shop.id, { country: "GB" })).toBe(gb.length);
    const csv = await ordersCsv(f.db, shop.id, { country: "GB", productId: f.products.lamp.id });
    const rows = csv.trim().split("\n").slice(1).map((r) => r.split(",")[0]!.replace(/\D/g, ""));
    expect([...new Set(rows)]).toEqual([String(lampGB.number)]);

    const countries = await orderCountries(f.db, shop.id);
    expect(countries.find((c) => c.country === "GB")?.count).toBe(gb.length);
    expect(countries.every((c) => /^[A-Z]{2}$/.test(c.country))).toBe(true);
  });
});
