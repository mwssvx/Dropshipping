import { describe, expect, it } from "vitest";
import { applyThemePreset, compactProducts, currentPreset, defaultTheme, parseTheme, secondPhoto } from "../src";

type ActiveProduct = Parameters<typeof compactProducts>[0][number];

describe("second photo on product cards", () => {
  it("is the next photo after the main one, or none", () => {
    expect(secondPhoto({ images: ["a.jpg", "b.jpg", "c.jpg"], imageUrl: "a.jpg" })).toBe("b.jpg");
    // The main photo can be any of them.
    expect(secondPhoto({ images: ["a.jpg", "b.jpg"], imageUrl: "b.jpg" })).toBe("a.jpg");
    expect(secondPhoto({ images: ["a.jpg"], imageUrl: "a.jpg" })).toBeNull();
    expect(secondPhoto({ images: [], imageUrl: "a.jpg" })).toBeNull();
    expect(secondPhoto({ images: [], imageUrl: null })).toBeNull();
    const card = compactProducts([{ id: "p", title: "Lamp", handle: "lamp", images: ["a.jpg", "b.jpg"], imageUrl: "a.jpg", variants: [{ priceMinor: 100, compareAtMinor: null, stock: null, contents: null }] } as unknown as ActiveProduct]);
    expect(card[0]!.hoverImageUrl).toBe("b.jpg");
  });

  it("is off for stores saved before it existed, and survives a theme switch", () => {
    const doc = defaultTheme("Shop");
    expect(doc.settings.hoverPhoto).toBe(false);
    const { hoverPhoto: _, ...old } = doc.settings;
    expect(parseTheme({ ...doc, settings: old }).settings.hoverPhoto).toBe(false);
    const on = parseTheme({ ...doc, settings: { ...doc.settings, hoverPhoto: true } });
    expect(currentPreset(on)).toBe(currentPreset(doc));
    expect(applyThemePreset(on, "bold", { replaceSections: true, shopName: "Shop" }).settings.hoverPhoto).toBe(true);
  });
});
