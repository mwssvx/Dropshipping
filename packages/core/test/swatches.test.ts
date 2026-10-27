import { describe, expect, it } from "vitest";
import { colorOption, createProduct, DemoModel, exportStore, getProduct, namedColor, productSwatches, setSwatches } from "../src";
import { makeFixture } from "../evals/fixture";

describe("colour swatches", () => {
  it("knows common colour names, in the store languages too", () => {
    expect(namedColor("Navy")).toBe("#1f2a4d");
    expect(namedColor("  navy   blue ")).toBe("#1f2a4d");
    expect(namedColor("Dusty Rose")).toBe(namedColor("rose"));
    expect(namedColor("Light Grey")).toBe("#cfcfcf");
    expect(namedColor("Schwarz")).toBe("#111111");
    expect(namedColor("Midnight")).toBeNull();
    expect(colorOption([{ options: { Size: "M", Colour: "Red" } }])).toBe("Colour");
    expect(colorOption([{ options: { Farbe: "Rot" } }])).toBe("Farbe");
    expect(colorOption([{ options: { Size: "M" } }])).toBeNull();
  });

  it("lets the merchant pick colours the names don't say, and keeps them in the export", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const tee = await createProduct(f.db, shopId, {
      title: "Linen Tee",
      status: "active",
      variants: [
        { title: "Navy", options: { Color: "Navy" }, priceMinor: 2500, stock: 3 },
        { title: "Sage", options: { Color: "Sage" }, priceMinor: 2500, stock: 3 },
        { title: "Midnight", options: { Color: "Midnight" }, priceMinor: 2500, stock: 3 },
      ],
    });
    const before = productSwatches(await getProduct(f.db, shopId, tee.id))!;
    expect(before.option).toBe("Color");
    expect(before.values.map((v) => [v.value, v.color])).toEqual([["Navy", "#1f2a4d"], ["Sage", "#9caf88"], ["Midnight", null]]);

    // Picking the name's own colour stores nothing; an empty one goes back to the name.
    const saved = await setSwatches(f.db, shopId, tee.id, { Navy: "#1F2A4D", Midnight: "#191970", Sage: "" });
    expect(saved.values.map((v) => [v.value, v.color, v.picked])).toEqual([["Navy", "#1f2a4d", false], ["Sage", "#9caf88", false], ["Midnight", "#191970", true]]);
    expect((await getProduct(f.db, shopId, tee.id)).swatches).toEqual({ Midnight: "#191970" });
    // Values not sent keep their colour.
    await setSwatches(f.db, shopId, tee.id, { Sage: "#aabbcc" });
    expect((await getProduct(f.db, shopId, tee.id)).swatches).toEqual({ Midnight: "#191970", Sage: "#aabbcc" });

    await expect(setSwatches(f.db, shopId, tee.id, { Purple: "#800080" })).rejects.toThrow("Purple isn't one of this product's colours.");
    await expect(setSwatches(f.db, shopId, tee.id, { Midnight: "blue" })).rejects.toThrow("Pick a colour for Midnight.");
    const plain = await createProduct(f.db, shopId, { title: "Mug", status: "active", variants: [{ title: "Default", priceMinor: 900, stock: 1 }] });
    await expect(setSwatches(f.db, shopId, plain.id, {})).rejects.toThrow("Add a colour option to this product first.");

    expect((await exportStore(f.db, shopId)).products.find((p) => p.title === "Linen Tee")!.swatches).toEqual({ Midnight: "#191970", Sage: "#aabbcc" });
  });
});
