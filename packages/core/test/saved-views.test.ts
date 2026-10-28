import { describe, expect, it } from "vitest";
import { createShop, deleteSavedView, DemoModel, listSavedViews, MAX_SAVED_VIEWS, saveView, signUp, viewQuery } from "../src";
import { makeFixture } from "../evals/fixture";

describe("saved views", () => {
  it("keep a list's own filters under a name, per list and per store", async () => {
    const f = await makeFixture(new DemoModel());
    const user = await signUp(f.db, { email: "views@example.com", password: "correct horse" });
    const shop = await createShop(f.db, user.id, { name: "Views", country: "US" });
    const other = await createShop(f.db, user.id, { name: "Other views", country: "US" });
    // Only the list's own parameters are kept, in a set order; the page number isn't.
    expect(viewQuery("products", { page: "3", tag: " summer ", stock: "sold_out", made: "up" })).toBe("tag=summer&stock=sold_out");
    expect(viewQuery("orders", { show: "problems", country: "GB", stock: "low" })).toBe("show=problems&country=GB");

    const sold = await saveView(f.db, shop.id, "products", { name: "  Sold   out ", params: { stock: "sold_out", page: "2" } });
    expect(sold).toMatchObject({ name: "Sold out", query: "stock=sold_out" });
    await saveView(f.db, shop.id, "orders", { name: "UK", params: { country: "GB" } });
    // The same name, in any case, replaces the view.
    await saveView(f.db, shop.id, "products", { name: "SOLD OUT", params: { stock: "sold_out", source: "supplier" } });
    expect((await listSavedViews(f.db, shop.id, "products")).map((v) => [v.name, v.query])).toEqual([["SOLD OUT", "stock=sold_out&source=supplier"]]);
    expect(await listSavedViews(f.db, other.id, "products")).toEqual([]);
    expect((await listSavedViews(f.db, shop.id, "orders")).map((v) => v.name)).toEqual(["UK"]);

    await expect(saveView(f.db, shop.id, "products", { name: "Nothing", params: { page: "2" } })).rejects.toThrow("Search or pick a filter first");
    await expect(saveView(f.db, shop.id, "products", { name: " ", params: { q: "mug" } })).rejects.toThrow("Give the view a name");
    await expect(saveView(f.db, shop.id, "products", { name: "x".repeat(41), params: { q: "mug" } })).rejects.toThrow("under 40 characters");
    for (let i = 1; i < MAX_SAVED_VIEWS; i++) await saveView(f.db, shop.id, "products", { name: `View ${i}`, params: { q: `q${i}` } });
    await expect(saveView(f.db, shop.id, "products", { name: "One more", params: { q: "more" } })).rejects.toThrow(`up to ${MAX_SAVED_VIEWS} saved views`);

    // A store can only remove its own views.
    await deleteSavedView(f.db, other.id, sold.id);
    expect(await listSavedViews(f.db, shop.id, "products")).toHaveLength(MAX_SAVED_VIEWS);
    await deleteSavedView(f.db, shop.id, sold.id);
    expect(await listSavedViews(f.db, shop.id, "products")).toHaveLength(MAX_SAVED_VIEWS - 1);
    await deleteSavedView(f.db, shop.id, "not-an-id");
  });
});
