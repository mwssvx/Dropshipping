import { describe, expect, it } from "vitest";
import { defaultTheme, parseTheme, SECTION_LABELS, SECTION_TYPES, sectionDefaults } from "../src";

describe("before and after section", () => {
  it("holds two https photos and their labels", () => {
    expect(SECTION_TYPES).toContain("before_after");
    expect(SECTION_LABELS.before_after.name).toBe("Before and after");
    expect(sectionDefaults("before_after")).toEqual({ heading: "", text: "", beforeUrl: "", afterUrl: "", beforeLabel: "", afterLabel: "" });
    const doc = defaultTheme("Shop");
    const pair = (settings: Record<string, unknown>) => ({ ...doc, home: [{ id: "pair0001", type: "before_after", hidden: false, settings }] });
    const set = { heading: "One wipe", text: "", beforeUrl: "https://images.example.com/dirty.jpg", afterUrl: "https://images.example.com/clean.jpg", beforeLabel: "Day 1", afterLabel: "Day 30" };
    expect(parseTheme(pair(set)).home[0]!.settings).toEqual(set);
    expect(() => parseTheme(pair({ ...set, afterUrl: "http://images.example.com/clean.jpg" }))).toThrow("https web address");
    expect(() => parseTheme(pair({ ...set, beforeLabel: "x".repeat(31) }))).toThrow("under 30 characters");
  });
});
