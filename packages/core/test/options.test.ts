import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { combineOptions, createProduct, DemoModel, optionDefsOf, updateProduct } from "../src";
import { makeFixture } from "../evals/fixture";

describe("product options", () => {
  it("makes every combination of the options, in order", () => {
    expect(combineOptions([{ name: "Color", values: ["Black", " White ", "Black", ""] }, { name: "Size", values: ["S", "M"] }])).toEqual([
      { title: "Black / S", options: { Color: "Black", Size: "S" } },
      { title: "Black / M", options: { Color: "Black", Size: "M" } },
      { title: "White / S", options: { Color: "White", Size: "S" } },
      { title: "White / M", options: { Color: "White", Size: "M" } },
    ]);
    expect(combineOptions([{ name: "", values: ["x"] }])).toEqual([]);
    expect(() => combineOptions([{ name: "Size", values: ["S"] }, { name: "size", values: ["M"] }])).toThrow("different name");
    expect(() => combineOptions(["A", "B", "C", "D"].map((name) => ({ name, values: ["1"] })))).toThrow("up to 3 options");
    const many = Array.from({ length: 11 }, (_, i) => String(i));
    expect(() => combineOptions([{ name: "A", values: many }, { name: "B", values: many }])).toThrow("121 combinations");
    expect(optionDefsOf([{ options: { Color: "Black", Size: "S" } }, { options: { Color: "White", Size: "S" } }, { options: null }])).toEqual([
      { name: "Color", values: ["Black", "White"] },
      { name: "Size", values: ["S"] },
    ]);
    // Stored options lose their order; the title keeps it.
    expect(optionDefsOf([{ title: "Red / L", options: { Size: "L", Color: "Red" } }]).map((d) => d.name)).toEqual(["Color", "Size"]);
  });

  it("edits options in place by id, adds new ones and removes the rest", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const combos = combineOptions([{ name: "Color", values: ["Black", "White"] }, { name: "Size", values: ["S", "M"] }]);
    const tee = await createProduct(f.db, shop.id, { title: "Tee", status: "active", variants: combos.map((c) => ({ ...c, priceMinor: 2000, stock: 5 })) });
    const before = await f.variants(tee.id);
    expect(before.map((v) => v.title)).toEqual(["Black / S", "Black / M", "White / S", "White / M"]);

    // Drop White, add L: the black ones keep their ids and stock, White goes, L is new.
    const next = combineOptions([{ name: "Color", values: ["Black"] }, { name: "Size", values: ["S", "M", "L"] }]);
    await updateProduct(f.db, shop.id, tee.id, {
      title: "Tee",
      status: "active",
      variants: next.map((c) => {
        const same = before.find((v) => v.title === c.title);
        return { ...c, id: same?.id, priceMinor: same?.priceMinor ?? 2500 };
      }),
    });
    const after = await f.variants(tee.id);
    expect(after.map((v) => [v.title, v.priceMinor])).toEqual([["Black / S", 2000], ["Black / M", 2000], ["Black / L", 2500]]);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[1]!.stock).toBe(5);
    expect(after[2]!.options).toEqual({ Color: "Black", Size: "L" });
    expect(await f.db.query.variants.findFirst({ where: eq(schema.variants.id, before[2]!.id) })).toBeUndefined();

    // An id from another product is refused.
    const [lamp] = await f.variants(f.products.lamp.id);
    await expect(updateProduct(f.db, shop.id, tee.id, { title: "Tee", status: "active", variants: [{ id: lamp!.id, title: "X", priceMinor: 1 }] })).rejects.toThrow("Reload the page");
  });
});
