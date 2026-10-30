import { describe, expect, it } from "vitest";
import { defaultTheme, LOGOS_MAX, parseTheme, SECTION_TYPES, sectionDefaults } from "../src";

describe("logo row", () => {
  it("holds up to a dozen logos with safe images and links", () => {
    expect(SECTION_TYPES).toContain("logo_list");
    expect(sectionDefaults("logo_list")).toEqual({ heading: "", tone: "grey", items: [] });
    const doc = defaultTheme("Shop");
    const row = (items: unknown[]) => ({ ...doc, home: [{ id: "logos001", type: "logo_list", hidden: false, settings: { heading: "As seen in", items } }] });
    const logo = { imageUrl: "https://example.com/press.svg", name: "Daily Press", link: "https://example.com/review" };

    const parsed = parseTheme(row([logo, { imageUrl: "", name: "", link: "" }])).home[0]!;
    expect(parsed.settings).toEqual({ heading: "As seen in", tone: "grey", items: [logo, { imageUrl: "", name: "", link: "" }] });
    expect(() => parseTheme(row(Array.from({ length: LOGOS_MAX + 1 }, () => logo)))).toThrow(`up to ${LOGOS_MAX} logos`);
    expect(() => parseTheme(row([{ ...logo, imageUrl: "http://example.com/a.png" }]))).toThrow("https web address");
    expect(() => parseTheme(row([{ ...logo, link: "javascript:alert(1)" }]))).toThrow("Links must start with");
  });
});
