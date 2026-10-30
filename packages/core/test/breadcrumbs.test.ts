import { describe, expect, it } from "vitest";
import { breadcrumbCollection, collectionFromReferer, createCollection, DemoModel, getActiveProductByHandle, type CollectionRules } from "../src";
import { makeFixture } from "../evals/fixture";

const rules = (conditions: CollectionRules["conditions"]): CollectionRules => ({ match: "all", sort: "newest", conditions });

describe("breadcrumbs on product pages", () => {
  it("reads the collection a shopper came from, only on this store", () => {
    expect(collectionFromReferer("https://storefront.test/s/lamps/collections/desk-lamps", "/s/lamps")).toBe("desk-lamps");
    expect(collectionFromReferer("https://storefront.test/s/lamps/collections/desk-lamps/?sort=newest", "/s/lamps")).toBe("desk-lamps");
    expect(collectionFromReferer("https://lamps.example.com/de/collections/lampen", "/de")).toBe("lampen");
    expect(collectionFromReferer("https://lamps.example.com/collections/gifts%20under%2025", "")).toBe("gifts under 25");
    expect(collectionFromReferer("https://storefront.test/s/other/collections/desk-lamps", "/s/lamps")).toBeNull();
    expect(collectionFromReferer("https://storefront.test/s/lamps/products/sunset", "/s/lamps")).toBeNull();
    expect(collectionFromReferer("https://storefront.test/s/lamps/collections/a/b", "/s/lamps")).toBeNull();
    expect(collectionFromReferer("https://storefront.test/s/lamps/collections/%E0%A4%A", "/s/lamps")).toBeNull();
    expect(collectionFromReferer(null, "/s/lamps")).toBeNull();
    expect(collectionFromReferer("not a url", "")).toBeNull();
  });

  it("uses the collection the shopper came from, else the first one the product is in", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, projector } = f.products;
    const product = async (handle: string) => getActiveProductByHandle(f.db, shop.id, handle);
    const lampP = await product(lamp.handle);
    expect(await breadcrumbCollection(f.db, shop.id, lampP)).toBeNull();

    const auto = await createCollection(f.db, shop.id, { title: "Lights", rules: rules([{ kind: "title_contains", text: lamp.title.split(" ").at(-1)! }]) });
    expect(await breadcrumbCollection(f.db, shop.id, lampP)).toEqual({ id: auto.id, title: "Lights", handle: auto.handle });

    // A collection picked by hand comes before one filled by rules.
    const desk = await createCollection(f.db, shop.id, { title: "Desk", productIds: [lamp.id, projector.id] });
    const gifts = await createCollection(f.db, shop.id, { title: "Gifts", productIds: [lamp.id] });
    expect(await breadcrumbCollection(f.db, shop.id, lampP)).toMatchObject({ title: "Desk" });

    // Coming from a collection the product is in keeps the shopper's trail.
    expect(await breadcrumbCollection(f.db, shop.id, lampP, gifts.handle)).toMatchObject({ title: "Gifts" });
    expect(await breadcrumbCollection(f.db, shop.id, lampP, auto.handle)).toMatchObject({ title: "Lights" });
    // Not one it isn't in, nor one that doesn't exist.
    const projectorP = await product(projector.handle);
    expect(await breadcrumbCollection(f.db, shop.id, projectorP, gifts.handle)).toMatchObject({ title: desk.title });
    expect(await breadcrumbCollection(f.db, shop.id, projectorP, "nope")).toMatchObject({ title: "Desk" });
  });
});
