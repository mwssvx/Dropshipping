import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  addonOffer, addWholesaleBuyer, amountToCharge, createAddon, createSale, createShop, deleteAddon, DemoModel, exportStore, handlePaymentEvent, importStore, listAddons, percentOff,
  pickAddonVariant, quoteCart, setAddonActive, setWholesaleSettings, signUp, startCheckout,
} from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  // The stand starts as a draft in the fixture; an add-on is something on sale.
  await f.db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, f.products.stand.id));
  const [small] = await f.variants(f.products.lamp.id);
  const [stand] = await f.variants(f.products.stand.id);
  return { ...f, shopRow: shop, small: small!, stand: stand! };
}

describe("checkout add-ons", () => {
  it("checks what the merchant enters", async () => {
    const f = await setup();
    const { lamp, projector, stand } = f.products;
    const make = (input: Parameters<typeof createAddon>[2]) => createAddon(f.db, f.shopRow.id, input);
    await expect(make({ productId: stand.id, percentOff: 60 })).rejects.toThrow("up to 50%");
    await expect(make({ productId: "00000000-0000-0000-0000-000000000000", percentOff: 10 })).rejects.toThrow("from your store");
    const a = await make({ productId: stand.id, percentOff: 30, pitch: "Keeps your phone up while it charges" });
    await expect(make({ productId: stand.id, percentOff: 10 })).rejects.toThrow("already an add-on");
    await make({ productId: lamp.id, percentOff: 0 });
    await make({ productId: projector.id, percentOff: 5 });
    expect((await listAddons(f.db, f.shopRow.id)).map((x) => [x.title, x.percentOff])).toEqual([
      [stand.title, 30],
      [lamp.title, 0],
      [projector.title, 5],
    ]);
    await deleteAddon(f.db, f.shopRow.id, a.id);
    await expect(deleteAddon(f.db, f.shopRow.id, a.id)).rejects.toThrow("not found");
  });

  it("offers one at checkout, priced with sales, and charges that price only with something else", async () => {
    const f = await setup();
    const { lamp, stand } = f.products;
    const addon = await createAddon(f.db, f.shopRow.id, { productId: stand.id, percentOff: 30, pitch: "Pairs well" });
    await createSale(f.db, f.shopRow.id, { title: "Stand sale", percentOff: 10, scope: "products", productIds: [stand.id], startsAt: new Date() });
    const expected = percentOff(percentOff(f.stand.priceMinor, 10), 30);

    expect(await addonOffer(f.db, f.shopRow, [])).toBeNull();
    const offer = (await addonOffer(f.db, f.shopRow, [lamp.id]))!;
    expect(offer).toMatchObject({ addon: { id: addon.id, pitch: "Pairs well" }, product: { id: stand.id } });
    expect(offer.variants[0]).toMatchObject({ id: f.stand.id, wasMinor: f.stand.priceMinor, priceMinor: expected });
    // Already in the cart: nothing more to offer.
    expect(await addonOffer(f.db, f.shopRow, [lamp.id, stand.id])).toBeNull();

    const both = await quoteCart(f.db, f.shopRow, [{ variantId: f.small.id, quantity: 1 }, { variantId: f.stand.id, quantity: 1 }]);
    const line = both.items.find((i) => i.variantId === f.stand.id)!;
    expect(line).toMatchObject({ unitPriceMinor: expected, addonId: addon.id, priceNote: "Stand sale: 10% off · Add-on price, 30% off" });
    // On its own it's the normal (sale) price.
    const alone = await quoteCart(f.db, f.shopRow, [{ variantId: f.stand.id, quantity: 1 }]);
    expect(alone.items[0]).toMatchObject({ unitPriceMinor: percentOff(f.stand.priceMinor, 10), addonId: null });

    await expect(pickAddonVariant(f.db, f.shopRow.id, addon.id, f.small.id)).rejects.toThrow();
    expect(await pickAddonVariant(f.db, f.shopRow.id, addon.id, f.stand.id)).toBe(f.stand.id);

    // Turned off, it isn't offered or priced.
    await setAddonActive(f.db, f.shopRow.id, addon.id, false);
    expect(await addonOffer(f.db, f.shopRow, [lamp.id])).toBeNull();
    const off = await quoteCart(f.db, f.shopRow, [{ variantId: f.small.id, quantity: 1 }, { variantId: f.stand.id, quantity: 1 }]);
    expect(off.items.find((i) => i.variantId === f.stand.id)!.addonId).toBeNull();
  });

  it("counts add-ons bought on paid orders, skips wholesale buyers, and travels in the store file", async () => {
    const f = await setup();
    const { stand } = f.products;
    const addon = await createAddon(f.db, f.shopRow.id, { productId: stand.id, percentOff: 20 });
    const lines = [{ variantId: f.small.id, quantity: 1 }, { variantId: f.stand.id, quantity: 2 }];
    const { order } = await startCheckout(f.db, f.payments, f.shopRow, { email: "ada@example.com", address, lines });
    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: amountToCharge(order) });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    const [row] = await listAddons(f.db, f.shopRow.id);
    expect(row).toMatchObject({ id: addon.id, live: true, bought: 1, revenueMinor: percentOff(f.stand.priceMinor, 20) * 2 });

    await setWholesaleSettings(f.db, f.shopRow.id, { enabled: true, percentOff: 25, minOrderMinor: 0 });
    await addWholesaleBuyer(f.db, await f.shop(), { email: "shop@corner.example", company: "Corner Shop" });
    const wholesale = await quoteCart(f.db, await f.shop(), lines, { buyerEmail: "shop@corner.example" });
    expect(wholesale.items.find((i) => i.variantId === f.stand.id)).toMatchObject({ addonId: null, unitPriceMinor: percentOff(f.stand.priceMinor, 25) });

    const file = JSON.parse(JSON.stringify(await exportStore(f.db, f.shopRow.id)));
    expect(file.checkout_addons).toEqual([{ product: stand.handle, percent_off: 20, pitch: null, active: true }]);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    expect((await importStore(f.db, copy.id, file)).checkoutAddons).toBe(1);
  });
});
