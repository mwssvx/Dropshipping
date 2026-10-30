import { describe, expect, it } from "vitest";
import { applyThemePreset, defaultTheme, parseTheme } from "../src/theme-doc";

describe("collection banners", () => {
  it("are on for new stores and stores saved before they existed, and a theme switch keeps the choice", () => {
    expect(defaultTheme("Shop").settings.collectionBanner).toBe(true);
    const old = defaultTheme("Shop") as { settings: Record<string, unknown> };
    delete old.settings.collectionBanner;
    expect(parseTheme(old).settings.collectionBanner).toBe(true);
    const off = parseTheme({ ...defaultTheme("Shop"), settings: { ...defaultTheme("Shop").settings, collectionBanner: false } });
    expect(applyThemePreset(off, "warm", { replaceSections: true, shopName: "Shop" }).settings.collectionBanner).toBe(false);
  });
});
