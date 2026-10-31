import { describe, expect, it } from "vitest";
import { defaultTheme, parseTheme } from "../src";

describe("footer email signup", () => {
  it("is off by default, also for themes saved before it existed", () => {
    const doc = defaultTheme("Shop");
    expect(doc.settings.footerSignup).toBe(false);
    const older: Partial<typeof doc.settings> = { ...doc.settings };
    delete older.footerSignup;
    expect(parseTheme({ ...doc, settings: older }).settings.footerSignup).toBe(false);
    expect(parseTheme({ ...doc, settings: { ...doc.settings, footerSignup: true } }).settings.footerSignup).toBe(true);
  });
});
