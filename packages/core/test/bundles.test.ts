import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  addWholesaleBuyer, bundleSavings, bundlesForProduct, createBundle, createDiscount, createShop, deleteBundle, DemoModel, exportStore, importStore, listBundles,
  pickBundleVariants, quoteCart, setBundleActive, setWholesaleSettings, signUp, startCheckout,
} from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const [small, large] = await f.variants(f.products.lamp.id);
  const [galaxy] = await f.variants(f.products.projector.id);
  return { ...f, small: small!, large: large!, galaxy: galaxy!, shopRow: await f.shop() };
}

describe("bundles", () => {
  it("checks what the merchant enters", async () => {
    const f = await setup();
    const { lamp, projector, stand } = f.products;
    const make = (input: Parameters<typeof createBundle>[2]) => createBundle(f.db, f.shopRow.id, input);
    await expect(make({ title: "Set", productIds: [lamp.id], percentOff: 10 })).rejects.toThrow("at least two");
    await expect(make({ title: "Set", productIds: [lamp.id, lamp.id], percentOff: 10 })).rejects.toThrow("each product once");
    await expect(make({ title: "Set", productIds: [lamp.id, projector.id], percentOff: 60 })).rejects.toThrow("up to 50%");
    await expect(make({ title: " ", productIds: [lamp.id, projector.id], percentOff: 10 })).rejects.toThrow("name");
    await expect(make({ title: "Set", productIds: [lamp.id, "00000000-0000-0000-0000-000000000000"], percentOff: 10 })).rejects.toThrow("from your store");

    // A draft product can be in a bundle; the bundle shows once it's on sale.
    const b = await make({ title: "Night set", productIds: [lamp.id, projector.id, stand.id], percentOff: 15 });
    expect((await listBundles(f.db, f.shopRow.id))[0]).toMatchObject({ title: "Night set", live: false, products: [{ title: "Sunset Projection Lamp" }, { title: "Galaxy Projector" }, {}] });
    expect(await bundlesForProduct(f.db, f.shopRow.id, lamp.id)).toEqual([]);
    await deleteBundle(f.db, f.shopRow.id, b.id);
    await expect(deleteBundle(f.db, f.shopRow.id, b.id)).rejects.toThrow("not found");
  });

  it("shows on each product's page and adds the options the buyer picked", async () => {
    const f = await setup();
    const { lamp, projector } = f.products;
    const b = await createBundle(f.db, f.shopRow.id, { title: "Night set", productIds: [lamp.id, projector.id], percentOff: 20 });
    const onProjector = await bundlesForProduct(f.db, f.shopRow.id, projector.id);
    expect(onProjector).toHaveLength(1);
    // The product being looked at comes first; prices use each product's cheapest option.
    expect(onProjector[0]!.products.map((p) => p.id)).toEqual([projector.id, lamp.id]);
    const full = f.small.priceMinor + f.galaxy.priceMinor;
    expect(onProjector[0]).toMatchObject({ percentOff: 20, fullMinor: full, bundleMinor: full - Math.round(full * 0.2) });

    expect(await pickBundleVariants(f.db, f.shopRow.id, b.id, { [lamp.id]: f.large.id })).toEqual([f.large.id, f.galaxy.id]);
    // A pick that isn't one of the product's options falls back to the first in stock.
    expect(await pickBundleVariants(f.db, f.shopRow.id, b.id, { [lamp.id]: f.galaxy.id })).toEqual([f.small.id, f.galaxy.id]);
    await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.productId, projector.id));
    expect(await bundlesForProduct(f.db, f.shopRow.id, lamp.id)).toEqual([]);
    await expect(pickBundleVariants(f.db, f.shopRow.id, b.id, {})).rejects.toThrow("sold out");

    await f.db.update(schema.variants).set({ stock: null }).where(eq(schema.variants.productId, projector.id));
    await setBundleActive(f.db, f.shopRow.id, b.id, false);
    expect(await bundlesForProduct(f.db, f.shopRow.id, lamp.id)).toEqual([]);
    await expect(pickBundleVariants(f.db, f.shopRow.id, b.id, {})).rejects.toThrow("not found");
  });

  it("takes the bundle's percentage off each full set, cheapest units first, one bundle per unit", () => {
    const items = [
      { productId: "a", unitPriceMinor: 1000, quantity: 2 },
      { productId: "a", unitPriceMinor: 800, quantity: 1 },
      { productId: "b", unitPriceMinor: 500, quantity: 1 },
      { productId: "c", unitPriceMinor: 300, quantity: 1 },
    ];
    const savings = bundleSavings(
      [
        { id: "1", title: "A+B", productIds: ["a", "b"], percentOff: 10 },
        { id: "2", title: "A+C", productIds: ["a", "c"], percentOff: 20 },
        { id: "3", title: "B+C", productIds: ["b", "c"], percentOff: 50 },
      ],
      items,
    );
    // B+C (50%) goes first and uses up B and C, so A has nothing left to pair with.
    expect(savings).toEqual([{ bundleId: "3", title: "B+C", percentOff: 50, sets: 1, savingMinor: 400 }]);
    const two = bundleSavings([{ id: "1", title: "A+B", productIds: ["a", "b"], percentOff: 10 }], [...items, { productId: "b", unitPriceMinor: 500, quantity: 1 }]);
    // Two sets: the two cheapest A units (800 + 1000) with both B units.
    expect(two).toEqual([{ bundleId: "1", title: "A+B", percentOff: 10, sets: 2, savingMinor: 280 }]);
  });

  it("prices the cart and order, and uses a code instead only when it saves more", async () => {
    const f = await setup();
    const { lamp, projector } = f.products;
    await createBundle(f.db, f.shopRow.id, { title: "Night set", productIds: [lamp.id, projector.id], percentOff: 20 });
    const lines = [{ variantId: f.small.id, quantity: 2 }, { variantId: f.galaxy.id, quantity: 1 }];
    const saving = Math.round((f.small.priceMinor + f.galaxy.priceMinor) * 0.2);
    const cart = await quoteCart(f.db, f.shopRow, lines);
    expect(cart.bundle).toMatchObject({ title: "Night set", discountMinor: saving });
    expect(cart.discountMinor).toBe(saving);
    expect(cart.totalMinor).toBe(cart.subtotalMinor - saving + cart.shippingMinor);
    // One product alone isn't a bundle.
    expect((await quoteCart(f.db, f.shopRow, lines.slice(0, 1))).bundle).toBeNull();

    await createDiscount(f.db, f.shopRow.id, { code: "TINY", kind: "percent", value: 1 });
    await createDiscount(f.db, f.shopRow.id, { code: "HALF", kind: "percent", value: 50 });
    const tiny = await quoteCart(f.db, f.shopRow, lines, { discountCode: "TINY" });
    expect(tiny).toMatchObject({ discount: null, codeNotUsed: "TINY", discountMinor: saving });
    const half = await quoteCart(f.db, f.shopRow, lines, { discountCode: "HALF" });
    expect(half).toMatchObject({ bundle: null, codeNotUsed: null, discount: { code: "HALF" } });

    const { order } = await startCheckout(f.db, f.payments, f.shopRow, { email: "ada@example.com", address, lines, discountCode: "TINY" });
    expect(order).toMatchObject({ discountMinor: saving, discountCode: null, discountId: null, bundleTitle: "Night set" });
    expect(order.totalMinor).toBe(order.subtotalMinor - saving + order.shippingMinor + (order.taxIncluded ? 0 : order.taxMinor));
  });

  it("leaves wholesale buyers on their own prices, and travels in the store file", async () => {
    const f = await setup();
    const { lamp, projector } = f.products;
    await createBundle(f.db, f.shopRow.id, { title: "Night set", productIds: [lamp.id, projector.id], percentOff: 20, active: false });
    await setBundleActive(f.db, f.shopRow.id, (await listBundles(f.db, f.shopRow.id))[0]!.id, true);
    await setWholesaleSettings(f.db, f.shopRow.id, { enabled: true, percentOff: 30, minOrderMinor: 0 });
    const ctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example" };
    await addWholesaleBuyer(ctx.db, await f.shop(), { email: "shop@corner.example", company: "Corner Shop" });
    const lines = [{ variantId: f.small.id, quantity: 1 }, { variantId: f.galaxy.id, quantity: 1 }];
    expect((await quoteCart(f.db, await f.shop(), lines, { buyerEmail: "shop@corner.example" })).bundle).toBeNull();

    const file = JSON.parse(JSON.stringify(await exportStore(f.db, f.shopRow.id)));
    expect(file.bundles).toEqual([{ title: "Night set", products: [lamp.handle, projector.handle], percent_off: 20, active: true }]);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    expect((await importStore(f.db, copy.id, file)).bundles).toBe(1);
    expect((await listBundles(f.db, copy.id))[0]).toMatchObject({ title: "Night set", percentOff: 20, products: [{ title: lamp.title }, { title: projector.title }] });
  });
});
