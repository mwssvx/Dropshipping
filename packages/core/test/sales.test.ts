import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  bundlesForProduct, createBundle, createCollection, createShop, createSale, DemoModel, endSale, exportStore, getActiveProductByHandle, importStore, listSales, percentOff,
  quoteCart, saveItem, salesFor, sendPriceDrops, setQuantityBreaks, signUp, withSales,
} from "../src";
import { makeFixture } from "../evals/fixture";

const HOUR = 3_600_000;

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const [small] = await f.variants(f.products.lamp.id);
  const [galaxy] = await f.variants(f.products.projector.id);
  return { ...f, shopRow: shop, small: small!, galaxy: galaxy! };
}

describe("sales", () => {
  it("checks what the merchant enters and lists sales by when they run", async () => {
    const f = await setup();
    const { lamp, projector } = f.products;
    const now = new Date();
    const make = (input: Partial<Parameters<typeof createSale>[2]>) =>
      createSale(f.db, f.shopRow.id, { title: "Summer sale", percentOff: 20, scope: "all", startsAt: now, ...input });
    await expect(make({ percentOff: 95 })).rejects.toThrow("up to 90%");
    await expect(make({ title: " " })).rejects.toThrow("name");
    await expect(make({ endsAt: new Date(now.getTime() - HOUR), startsAt: new Date(now.getTime() - 2 * HOUR) })).rejects.toThrow("already passed");
    await expect(make({ endsAt: now, startsAt: new Date(now.getTime() + HOUR) })).rejects.toThrow("end after it starts");
    await expect(make({ scope: "collection" })).rejects.toThrow("Pick the collection");
    await expect(make({ scope: "products", productIds: [] })).rejects.toThrow("at least one product");
    await expect(make({ scope: "products", productIds: ["00000000-0000-0000-0000-000000000000"] })).rejects.toThrow("from your store");

    const running = await make({ scope: "products", productIds: [lamp.id], endsAt: new Date(now.getTime() + HOUR) });
    const later = await make({ title: "Weekend", startsAt: new Date(now.getTime() + 24 * HOUR) });
    const sales = await listSales(f.db, f.shopRow.id);
    expect(sales.map((s) => [s.title, s.status, s.covers])).toEqual([
      ["Summer sale", "running", "1 product"],
      ["Weekend", "scheduled", "Everything except gift cards"],
    ]);
    // Ending a sale that hasn't started removes it; ending a running one stops it now.
    await endSale(f.db, f.shopRow.id, later.id);
    await endSale(f.db, f.shopRow.id, running.id);
    expect((await listSales(f.db, f.shopRow.id)).map((s) => s.status)).toEqual(["ended"]);
    expect((await salesFor(f.db, f.shopRow.id, [lamp.id, projector.id])).size).toBe(0);
  });

  it("covers everything, a collection or chosen products, and the biggest overlapping sale wins", async () => {
    const f = await setup();
    const { lamp, projector, stand } = f.products;
    const now = new Date();
    const lamps = await createCollection(f.db, f.shopRow.id, { title: "Lamps", productIds: [lamp.id] });
    await createSale(f.db, f.shopRow.id, { title: "Lamp week", percentOff: 30, scope: "collection", collectionId: lamps.id, startsAt: now });
    await createSale(f.db, f.shopRow.id, { title: "Everything", percentOff: 10, scope: "all", startsAt: now });
    await createSale(f.db, f.shopRow.id, { title: "Stand deal", percentOff: 5, scope: "products", productIds: [stand.id], startsAt: now });
    const map = await salesFor(f.db, f.shopRow.id, [lamp.id, projector.id, stand.id]);
    expect(map.get(lamp.id)).toMatchObject({ title: "Lamp week", percentOff: 30 });
    expect(map.get(projector.id)).toMatchObject({ title: "Everything", percentOff: 10 });
    expect(map.get(stand.id)).toMatchObject({ title: "Everything", percentOff: 10 });

    // The store shows sale prices with the old price crossed out, on full products and cards.
    const product = await getActiveProductByHandle(f.db, f.shopRow.id, lamp.handle);
    const [shown] = await withSales(f.db, f.shopRow.id, [product]);
    expect(shown!.variants[0]).toMatchObject({ priceMinor: percentOff(f.small.priceMinor, 30), compareAtMinor: Math.max(f.small.compareAtMinor ?? 0, f.small.priceMinor) });
    const [card] = await withSales(f.db, f.shopRow.id, [{ id: projector.id, priceMinor: 1000, compareAtMinor: null }]);
    expect(card).toMatchObject({ priceMinor: 900, compareAtMinor: 1000, sale: { title: "Everything" } });
  });

  it("charges the sale price, with quantity and bundle discounts on top of it", async () => {
    const f = await setup();
    const { lamp, projector } = f.products;
    await createSale(f.db, f.shopRow.id, { title: "Lamp sale", percentOff: 25, scope: "products", productIds: [lamp.id], startsAt: new Date() });
    const sale = percentOff(f.small.priceMinor, 25);
    const cart = await quoteCart(f.db, f.shopRow, [{ variantId: f.small.id, quantity: 1 }]);
    expect(cart.items[0]).toMatchObject({ listUnitPriceMinor: f.small.priceMinor, unitPriceMinor: sale, priceNote: "Lamp sale: 25% off" });

    await setQuantityBreaks(f.db, f.shopRow.id, lamp.id, [{ minQty: 2, percentOff: 10 }]);
    const two = await quoteCart(f.db, f.shopRow, [{ variantId: f.small.id, quantity: 2 }]);
    expect(two.items[0]!.unitPriceMinor).toBe(percentOff(sale, 10));
    expect(two.items[0]!.priceNote).toMatch(/^Lamp sale: 25% off · /);

    await createBundle(f.db, f.shopRow.id, { title: "Night set", productIds: [lamp.id, projector.id], percentOff: 20 });
    const [bundle] = await bundlesForProduct(f.db, f.shopRow.id, projector.id);
    expect(bundle!.fullMinor).toBe(f.galaxy.priceMinor + sale);
    const set = await quoteCart(f.db, f.shopRow, [{ variantId: f.small.id, quantity: 1 }, { variantId: f.galaxy.id, quantity: 1 }]);
    expect(set.bundle!.discountMinor).toBe(Math.round((sale + f.galaxy.priceMinor) * 0.2));
  });

  it("emails buyers who saved a product when its sale starts, and ends on time", async () => {
    const f = await setup();
    const { lamp } = f.products;
    const ada = (await f.db.insert(schema.customers).values({ shopId: f.shopRow.id, email: "ada@example.com" }).returning())[0]!;
    await saveItem(f.db, f.shopRow.id, ada.id, lamp.id);
    const start = new Date(f.ctx.now!().getTime() + HOUR);
    await createSale(f.db, f.shopRow.id, { title: "Flash sale", percentOff: 40, scope: "products", productIds: [lamp.id], startsAt: start, endsAt: new Date(start.getTime() + 2 * HOUR) }, f.ctx.now!());
    const ctx = { ...f.ctx, storeAddress: () => "https://glow.example" };
    expect(await sendPriceDrops(ctx)).toEqual({ sent: 0 });
    f.advance(HOUR + 1);
    expect(await sendPriceDrops(ctx)).toEqual({ sent: 1 });
    expect(f.mailer.sent.at(-1)!.subject).toBe(`Price drop: ${lamp.title}`);
    f.advance(2 * HOUR);
    expect((await salesFor(f.db, f.shopRow.id, [lamp.id], f.ctx.now!())).size).toBe(0);
    // Saved during a sale: the sale price is what they saw.
    const grace = (await f.db.insert(schema.customers).values({ shopId: f.shopRow.id, email: "grace@example.com" }).returning())[0]!;
    await createSale(f.db, f.shopRow.id, { title: "Again", percentOff: 40, scope: "all", startsAt: f.ctx.now!() }, f.ctx.now!());
    await saveItem(f.db, f.shopRow.id, grace.id, lamp.id, f.ctx.now!());
    const row = await f.db.query.savedItems.findFirst({ where: eq(schema.savedItems.customerId, grace.id) });
    expect(row!.priceMinor).toBe(percentOff(f.small.priceMinor, 40));
  });

  it("travels in the store file while it hasn't ended", async () => {
    const f = await setup();
    const { lamp } = f.products;
    const lamps = await createCollection(f.db, f.shopRow.id, { title: "Lamps", productIds: [lamp.id] });
    const now = new Date();
    await createSale(f.db, f.shopRow.id, { title: "Lamp week", percentOff: 30, scope: "collection", collectionId: lamps.id, startsAt: now, endsAt: new Date(now.getTime() + 24 * HOUR) });
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, f.shopRow.id)));
    expect(file.sales).toEqual([expect.objectContaining({ title: "Lamp week", percent_off: 30, scope: "collection", collection: lamps.handle, products: [] })]);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    expect((await importStore(f.db, copy.id, file)).sales).toBe(1);
    expect((await listSales(f.db, copy.id))[0]).toMatchObject({ title: "Lamp week", status: "running", covers: "The Lamps collection" });
  });
});
