import { describe, expect, it } from "vitest";
import { defaultTheme, parseTheme } from "../src";

// Checks that survive validation-library upgrades: missing values read plainly, and nested
// settings saved before they existed still get their defaults.
describe("validation", () => {
  it("fills in nested defaults and names a missing value plainly", () => {
    const doc = JSON.parse(JSON.stringify(defaultTheme("Lamps")));
    delete doc.settings.layout;
    delete doc.settings.seo;
    const parsed = parseTheme(doc);
    expect(parsed.settings.layout).toEqual({ header: "classic", productImage: "square", columns: 4, cards: "plain", buttons: "filled" });
    expect(parsed.settings.seo).toEqual({ title: "", description: "" });
    delete doc.settings.colors;
    expect(() => parseTheme(doc)).toThrow("Missing a value at settings.colors.");
  });
});
