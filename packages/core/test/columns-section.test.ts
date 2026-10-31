import { describe, expect, it } from "vitest";
import { COLUMNS_MAX, defaultTheme, parseTheme, SECTION_LABELS, SECTION_TYPES, sectionDefaults } from "../src";

describe("columns section", () => {
  it("holds up to six columns with safe pictures and links", () => {
    expect(SECTION_TYPES).toContain("columns");
    expect(SECTION_LABELS.columns.name).toBe("Columns");
    expect(sectionDefaults("columns")).toEqual({ heading: "", align: "center", items: [] });
    const doc = defaultTheme("Shop");
    const row = (items: unknown[], extra = {}) => ({ ...doc, home: [{ id: "cols0001", type: "columns", hidden: false, settings: { heading: "How it works", items, ...extra } }] });
    const column = { imageUrl: "https://example.com/pick.jpg", title: "Pick", text: "Choose what you like.", linkLabel: "Shop now", link: "/collections/all" };

    const parsed = parseTheme(row([column, { title: "Wait" }], { align: "left" })).home[0]!;
    expect(parsed.settings).toEqual({
      heading: "How it works",
      align: "left",
      items: [column, { imageUrl: "", title: "Wait", text: "", linkLabel: "", link: "" }],
    });
    expect(() => parseTheme(row(Array.from({ length: COLUMNS_MAX + 1 }, () => column)))).toThrow(`up to ${COLUMNS_MAX} columns`);
    expect(() => parseTheme(row([{ ...column, imageUrl: "http://example.com/a.png" }]))).toThrow("https web address");
    expect(() => parseTheme(row([{ ...column, link: "javascript:alert(1)" }]))).toThrow("Links must start with");
  });
});
