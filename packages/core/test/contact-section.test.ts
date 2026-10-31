import { describe, expect, it } from "vitest";
import { defaultTheme, parseTheme, SECTION_LABELS, SECTION_TYPES, sectionDefaults } from "../src";

describe("contact form section", () => {
  it("holds a heading and a line of text, both optional", () => {
    expect(SECTION_TYPES).toContain("contact_form");
    expect(SECTION_LABELS.contact_form.name).toBe("Contact form");
    expect(sectionDefaults("contact_form")).toEqual({ heading: "", text: "" });
    const doc = defaultTheme("Shop");
    const form = (settings: Record<string, unknown>) => ({ ...doc, home: [{ id: "form0001", type: "contact_form", hidden: false, settings }] });
    expect(parseTheme(form({ heading: "Ask us anything", text: "We answer within a day." })).home[0]!.settings).toEqual({ heading: "Ask us anything", text: "We answer within a day." });
    expect(() => parseTheme(form({ heading: "", text: "x".repeat(401) }))).toThrow("under 400 characters");
  });
});
