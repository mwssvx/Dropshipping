import { describe, expect, it } from "vitest";
import { createCollection, DemoModel, getCollection, updateCollection } from "../src";
import { makeFixture } from "../evals/fixture";

describe("a collection's own order", () => {
  it("is picked by the merchant and kept when left out", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, projector } = f.products;
    const c = await createCollection(f.db, shop.id, { title: "Gifts", productIds: [lamp.id, projector.id] });
    expect(c.sortOrder).toBe("featured");
    await updateCollection(f.db, shop.id, c.id, { title: "Gifts", productIds: [lamp.id, projector.id], sortOrder: "best_selling" });
    expect((await getCollection(f.db, shop.id, c.id)).sortOrder).toBe("best_selling");
    // Saving without it (an older form, an import) leaves it as it was.
    await updateCollection(f.db, shop.id, c.id, { title: "Gift ideas", productIds: [projector.id] });
    expect(await getCollection(f.db, shop.id, c.id)).toMatchObject({ title: "Gift ideas", sortOrder: "best_selling", productIds: [projector.id] });
    await expect(updateCollection(f.db, shop.id, c.id, { title: "Gifts", sortOrder: "random" as never })).rejects.toThrow("Pick how the collection is sorted.");
    const cheap = await createCollection(f.db, shop.id, { title: "Under $30", productIds: [], sortOrder: "price_asc" });
    expect(cheap.sortOrder).toBe("price_asc");
  });
});
