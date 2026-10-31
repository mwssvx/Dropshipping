import { describe, expect, it } from "vitest";
import { defaultTheme, parseTheme, SECTION_TYPES, sectionDefaults, SLIDES_MAX } from "../src";

describe("slideshow section", () => {
  it("holds up to five slides that take turns every few seconds", () => {
    expect(SECTION_TYPES).toContain("slideshow");
    expect(sectionDefaults("slideshow")).toEqual({ slides: [], seconds: 6, height: "medium", align: "center" });
    const doc = defaultTheme("Shop");
    const show = (slides: unknown[], extra = {}) => ({ ...doc, home: [{ id: "slides01", type: "slideshow", hidden: false, settings: { slides, ...extra } }] });
    const slide = { imageUrl: "https://example.com/summer.jpg", heading: "Summer is here", text: "Light linen for hot days.", buttonLabel: "Shop summer", buttonLink: "/collections/summer" };

    const parsed = parseTheme(show([slide, { heading: "Free returns" }], { seconds: 8 })).home[0]!;
    expect(parsed.settings).toEqual({
      slides: [slide, { imageUrl: "", heading: "Free returns", text: "", buttonLabel: "", buttonLink: "" }],
      seconds: 8,
      height: "medium",
      align: "center",
    });
    expect(() => parseTheme(show(Array.from({ length: SLIDES_MAX + 1 }, () => slide)))).toThrow(`up to ${SLIDES_MAX} slides`);
    expect(() => parseTheme(show([slide], { seconds: 1 }))).toThrow();
    expect(() => parseTheme(show([{ ...slide, imageUrl: "http://example.com/a.jpg" }]))).toThrow("https web address");
    expect(() => parseTheme(show([{ ...slide, buttonLink: "javascript:alert(1)" }]))).toThrow("Links must start with");
  });
});
