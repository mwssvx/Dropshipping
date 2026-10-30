import { describe, expect, it } from "vitest";
import { applyThemePreset, currentPreset, defaultTheme, parseTheme } from "../src";

describe("sticky header", () => {
  it("is off for stores saved before it existed, and survives a theme switch", () => {
    const doc = defaultTheme("Shop");
    expect(doc.settings.stickyHeader).toBe(false);
    const { stickyHeader: _, ...old } = doc.settings;
    expect(parseTheme({ ...doc, settings: old }).settings.stickyHeader).toBe(false);

    const sticky = parseTheme({ ...doc, settings: { ...doc.settings, stickyHeader: true } });
    // Turning it on doesn't count as changing the ready-made look.
    expect(currentPreset(sticky)).toBe(currentPreset(doc));
    expect(applyThemePreset(sticky, "bold", { replaceSections: true, shopName: "Shop" }).settings.stickyHeader).toBe(true);
  });
});
