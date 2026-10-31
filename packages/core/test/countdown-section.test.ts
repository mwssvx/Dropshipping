import { describe, expect, it } from "vitest";
import { defaultTheme, parseTheme, SECTION_LABELS, SECTION_TYPES, sectionDefaults } from "../src";

describe("countdown section", () => {
  it("counts down to one moment, saved with its time zone", () => {
    expect(SECTION_TYPES).toContain("countdown");
    expect(SECTION_LABELS.countdown.name).toBe("Countdown");
    expect(sectionDefaults("countdown")).toEqual({ heading: "", text: "", endsAt: "", buttonLabel: "", buttonLink: "" });
    const doc = defaultTheme("Shop");
    const clock = (settings: Record<string, unknown>) => ({ ...doc, home: [{ id: "count001", type: "countdown", hidden: false, settings }] });

    const set = { heading: "Black Friday starts in", text: "", endsAt: "2026-11-27T05:00:00.000Z", buttonLabel: "Get early access", buttonLink: "/pages/early" };
    expect(parseTheme(clock(set)).home[0]!.settings).toEqual(set);
    expect(parseTheme(clock({ endsAt: "2026-11-27T00:00:00-05:00" })).home[0]!.settings).toMatchObject({ endsAt: "2026-11-27T00:00:00-05:00" });
    expect(() => parseTheme(clock({ endsAt: "next friday" }))).toThrow("Pick a date and time.");
    expect(() => parseTheme(clock({ endsAt: "2026-11-27T00:00" }))).toThrow("Pick a date and time.");
    expect(() => parseTheme(clock({ ...set, buttonLink: "javascript:alert(1)" }))).toThrow("Links must start with");
  });
});
