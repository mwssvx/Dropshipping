import { describe, expect, it } from "vitest";
import { defaultTheme, parseTheme } from "../src";

describe("back to top button", () => {
  it("is off by default, also for themes saved before it existed", () => {
    const doc = defaultTheme("Shop");
    expect(doc.settings.backToTop).toBe(false);
    const older: Partial<typeof doc.settings> = { ...doc.settings };
    delete older.backToTop;
    expect(parseTheme({ ...doc, settings: older }).settings.backToTop).toBe(false);
    expect(parseTheme({ ...doc, settings: { ...doc.settings, backToTop: true } }).settings.backToTop).toBe(true);
  });
});
