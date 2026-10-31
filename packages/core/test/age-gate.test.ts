import { describe, expect, it } from "vitest";
import { defaultTheme, parseTheme } from "../src";

describe("age check on entry", () => {
  it("is off by default and takes 18 or 21", () => {
    const doc = defaultTheme("Shop");
    expect(parseTheme(doc).settings.ageGate).toBeNull();
    const at = (ageGate: unknown) => parseTheme({ ...doc, settings: { ...doc.settings, ageGate } }).settings.ageGate;
    expect(at(18)).toBe(18);
    expect(at(21)).toBe(21);
    expect(() => at(16)).toThrow();
    // Themes saved before the setting existed don't ask.
    const { ageGate: _, ...old } = doc.settings;
    expect(parseTheme({ ...doc, settings: old }).settings.ageGate).toBeNull();
  });
});
