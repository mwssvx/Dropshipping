import { describe, expect, it } from "vitest";
import { defaultTheme, parseTheme, sectionDefaults } from "../src";
import { SECTION_LABELS, SECTION_TYPES } from "../src/theme-doc";

describe("the home page's recently viewed section", () => {
  it("is a section with a heading and how many to show", () => {
    expect(SECTION_TYPES).toContain("recently_viewed");
    expect(SECTION_LABELS.recently_viewed.name).toBe("Recently viewed");
    expect(sectionDefaults("recently_viewed")).toEqual({ heading: "", limit: 4 });
    const theme = parseTheme({ ...defaultTheme("Glow Lamps"), home: [{ id: "recent1", type: "recently_viewed", settings: { heading: "Pick up where you left off", limit: 6 } }] });
    expect(theme.home[0]).toMatchObject({ type: "recently_viewed", settings: { heading: "Pick up where you left off", limit: 6 } });
    expect(() => parseTheme({ ...defaultTheme("Glow Lamps"), home: [{ id: "recent1", type: "recently_viewed", settings: { limit: 1 } }] })).toThrow();
    expect(() => parseTheme({ ...defaultTheme("Glow Lamps"), home: [{ id: "recent1", type: "recently_viewed", settings: { limit: 13 } }] })).toThrow();
  });
});
