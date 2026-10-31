import { describe, expect, it } from "vitest";
import { defaultTheme, GALLERY_MAX, parseTheme, SECTION_LABELS, SECTION_TYPES, sectionDefaults } from "../src";

describe("photo gallery section", () => {
  it("holds up to eight photos with safe pictures and links", () => {
    expect(SECTION_TYPES).toContain("gallery");
    expect(SECTION_LABELS.gallery.name).toBe("Photo gallery");
    expect(sectionDefaults("gallery")).toEqual({ heading: "", text: "", items: [], buttonLabel: "", buttonLink: "" });
    const doc = defaultTheme("Shop");
    const grid = (settings: Record<string, unknown>) => ({ ...doc, home: [{ id: "gall0001", type: "gallery", hidden: false, settings }] });
    const photo = { imageUrl: "https://images.example.com/desk.jpg", alt: "The lamp on a desk", link: "https://www.instagram.com/p/abc" };

    expect(parseTheme(grid({ heading: "Follow us", items: [photo, { imageUrl: "https://images.example.com/bed.jpg" }], buttonLabel: "Follow", buttonLink: "https://www.instagram.com/shop" })).home[0]!.settings).toEqual({
      heading: "Follow us",
      text: "",
      items: [photo, { imageUrl: "https://images.example.com/bed.jpg", alt: "", link: "" }],
      buttonLabel: "Follow",
      buttonLink: "https://www.instagram.com/shop",
    });
    expect(() => parseTheme(grid({ items: Array.from({ length: GALLERY_MAX + 1 }, () => photo) }))).toThrow(`up to ${GALLERY_MAX} photos`);
    expect(() => parseTheme(grid({ items: [{ ...photo, imageUrl: "http://images.example.com/a.jpg" }] }))).toThrow("https web address");
    expect(() => parseTheme(grid({ items: [{ ...photo, link: "javascript:alert(1)" }] }))).toThrow("Links must start with");
  });
});
