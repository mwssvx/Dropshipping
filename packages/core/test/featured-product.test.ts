import { describe, expect, it } from "vitest";
import { defaultTheme, parseTheme, SECTION_LABELS, SECTION_TYPES, sectionDefaults } from "../src";

describe("featured product section", () => {
  it("holds one picked product, a few words and which side the photo sits", () => {
    expect(SECTION_TYPES).toContain("featured_product");
    expect(SECTION_LABELS.featured_product.name).toBe("Featured product");
    expect(sectionDefaults("featured_product")).toEqual({ productId: null, text: "", imagePosition: "left" });
    const doc = defaultTheme("Shop");
    const one = (settings: Record<string, unknown>) => ({ ...doc, home: [{ id: "feat0001", type: "featured_product", hidden: false, settings }] });
    const id = "00000000-0000-4000-8000-000000000001";

    expect(parseTheme(one({ productId: id, text: "Our best seller.", imagePosition: "right" })).home[0]!.settings).toEqual({ productId: id, text: "Our best seller.", imagePosition: "right" });
    expect(parseTheme(one({})).home[0]!.settings).toEqual({ productId: null, text: "", imagePosition: "left" });
    expect(() => parseTheme(one({ productId: "lamp" }))).toThrow();
    expect(() => parseTheme(one({ productId: id, text: "x".repeat(601) }))).toThrow();
  });
});
