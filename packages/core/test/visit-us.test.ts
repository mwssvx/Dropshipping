import { describe, expect, it } from "vitest";
import { defaultTheme, directionsUrl, HOURS_MAX, parseTheme, SECTION_LABELS, SECTION_TYPES, sectionDefaults } from "../src";

describe("visit us section", () => {
  it("holds an address, opening hours and a photo", () => {
    expect(SECTION_TYPES).toContain("store_location");
    expect(SECTION_LABELS.store_location.name).toBe("Visit us");
    expect(sectionDefaults("store_location")).toEqual({ heading: "", address: "", hours: [], text: "", imageUrl: "" });
    const doc = defaultTheme("Shop");
    const visit = (settings: Record<string, unknown>) => ({ ...doc, home: [{ id: "visit001", type: "store_location", hidden: false, settings }] });
    const set = { heading: "", address: "12 Mill Lane\nBristol BS1 4RB", hours: [{ days: "Mon–Fri", time: "9:00–17:30" }, { days: "Sat", time: "10:00–16:00" }], text: "", imageUrl: "https://images.example.com/shop.jpg" };
    expect(parseTheme(visit(set)).home[0]!.settings).toEqual(set);
    const rows = Array.from({ length: HOURS_MAX + 1 }, () => ({ days: "Mon", time: "9–5" }));
    expect(() => parseTheme(visit({ ...set, hours: rows }))).toThrow(`Add up to ${HOURS_MAX} rows of opening hours.`);
    expect(() => parseTheme(visit({ ...set, address: "x".repeat(301) }))).toThrow("under 300 characters");
  });

  it("links to a map search for the address on one line", () => {
    expect(directionsUrl("12 Mill Lane\n Bristol  BS1 4RB ")).toBe("https://www.google.com/maps/search/?api=1&query=12%20Mill%20Lane%20Bristol%20BS1%204RB");
  });
});
