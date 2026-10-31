import { describe, expect, it } from "vitest";
import { defaultTheme, MARQUEE_MAX, parseTheme, SECTION_LABELS, SECTION_TYPES, sectionDefaults } from "../src";

describe("scrolling text section", () => {
  it("holds up to eight short messages, a speed and a size", () => {
    expect(SECTION_TYPES).toContain("scrolling_text");
    expect(SECTION_LABELS.scrolling_text.name).toBe("Scrolling text");
    expect(sectionDefaults("scrolling_text")).toEqual({ items: [], speed: "medium", size: "large" });
    const doc = defaultTheme("Shop");
    const row = (settings: Record<string, unknown>) => ({ ...doc, home: [{ id: "roll0001", type: "scrolling_text", hidden: false, settings }] });
    expect(parseTheme(row({ items: [{ text: "Free shipping" }, {}], speed: "fast", size: "small" })).home[0]!.settings).toEqual({
      items: [{ text: "Free shipping" }, { text: "" }],
      speed: "fast",
      size: "small",
    });
    expect(() => parseTheme(row({ items: Array.from({ length: MARQUEE_MAX + 1 }, () => ({ text: "Hi" })) }))).toThrow(`up to ${MARQUEE_MAX} messages`);
    expect(() => parseTheme(row({ items: [{ text: "x".repeat(81) }] }))).toThrow("under 80 characters");
    expect(() => parseTheme(row({ speed: "warp" }))).toThrow();
  });
});
