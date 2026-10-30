import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { COMPARE_MAX, compareDetail, compareIdsFrom, compareProducts, DemoModel, toggleCompareId } from "../src";
import { makeFixture } from "../evals/fixture";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("compare", () => {
  it("keeps up to four products, in the order they were added", () => {
    expect(compareIdsFrom(["nope", id(1), id(1), 7])).toEqual([id(1)]);
    expect(compareIdsFrom("x")).toEqual([]);
    let ids: string[] = [];
    for (let n = 1; n <= COMPARE_MAX; n++) ids = toggleCompareId(ids, id(n), true).ids;
    expect(ids).toEqual([id(1), id(2), id(3), id(4)]);
    expect(toggleCompareId(ids, id(5), true)).toEqual({ ids, full: true });
    expect(toggleCompareId(ids, id(2), true)).toEqual({ ids, full: false });
    expect(toggleCompareId(ids, id(2), false)).toEqual({ ids: [id(1), id(3), id(4)], full: false });
  });

  it("lines up price, rating, options, stock and the details table", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const { lamp, projector, stand } = f.products;
    await f.db.update(schema.products).set({ details: [{ label: "Material", value: "Glass" }, { label: "Power", value: "USB-C" }] }).where(eq(schema.products.id, lamp.id));
    await f.db.update(schema.products).set({ details: [{ label: "power", value: "Mains" }, { label: "Range", value: "5 m" }] }).where(eq(schema.products.id, projector.id));
    await f.db.insert(schema.reviews).values([
      { shopId, productId: lamp.id, name: "Ada", rating: 5, body: "Lovely", status: "published" },
      { shopId, productId: lamp.id, name: "Bo", rating: 4, body: "Good", status: "published" },
      { shopId, productId: lamp.id, name: "Cy", rating: 1, body: "Spam", status: "hidden" },
    ]);
    await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.productId, projector.id));

    // The draft drops out; the order is the shopper's.
    const { products, labels } = await compareProducts(f.db, shopId, [projector.id, stand.id, lamp.id]);
    expect(products.map((p) => p.title)).toEqual([projector.title, lamp.title]);
    expect(labels).toEqual(["power", "Range", "Material"]);
    const [proj, lmp] = products;
    expect(lmp!.rating).toEqual({ count: 2, average: 4.5 });
    expect(proj!.rating).toEqual({ count: 0, average: null });
    expect(proj!.soldOut).toBe(true);
    expect(lmp!.soldOut).toBe(false);
    expect(lmp!.variants.length).toBeGreaterThan(0);
    expect(compareDetail(lmp!.details, "power")).toBe("USB-C");
    expect(compareDetail(lmp!.details, "Range")).toBeNull();
    expect(await compareProducts(f.db, shopId, [])).toEqual({ products: [], labels: [] });
  });
});
