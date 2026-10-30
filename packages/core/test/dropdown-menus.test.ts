import { describe, expect, it } from "vitest";
import { defaultTheme, MENU_CHILDREN_MAX, parseTheme, themeStrings, translateTheme } from "../src";

describe("dropdown menus", () => {
  const doc = defaultTheme("Shop");
  const withHeader = (header: unknown[]) => ({ ...doc, menus: { ...doc.menus, header } });

  it("keeps old menus as they were, with no dropdowns", () => {
    const parsed = parseTheme(withHeader([{ label: "Home", href: "/" }]));
    expect(parsed.menus.header).toEqual([{ label: "Home", href: "/", children: [] }]);
    expect(defaultTheme("Shop").menus.header.every((m) => m.children.length === 0)).toBe(true);
  });

  it("holds one level of links under a menu item, with safe links", () => {
    const lamps = { label: "Lamps", href: "", children: [{ label: "Desk lamps", href: "/collections/desk" }, { label: "Floor lamps", href: "/collections/floor" }] };
    expect(parseTheme(withHeader([lamps])).menus.header[0]).toEqual(lamps);
    const many = Array.from({ length: MENU_CHILDREN_MAX + 1 }, (_, i) => ({ label: `L${i}`, href: "/" }));
    expect(() => parseTheme(withHeader([{ ...lamps, children: many }]))).toThrow(`up to ${MENU_CHILDREN_MAX} links`);
    expect(() => parseTheme(withHeader([{ ...lamps, children: [{ label: "Bad", href: "javascript:alert(1)" }] }]))).toThrow("Links must start with");
    expect(() => parseTheme(withHeader([{ ...lamps, children: [{ label: " ", href: "/" }] }]))).toThrow("needs a label");
    // Only one level: links under links are dropped.
    const deep = parseTheme(withHeader([{ ...lamps, children: [{ label: "Desk lamps", href: "/", children: [{ label: "Too deep", href: "/" }] }] }]));
    expect(deep.menus.header[0]!.children[0]).toEqual({ label: "Desk lamps", href: "/" });
  });

  it("translates the dropdown's labels with the rest of the menu", () => {
    const parsed = parseTheme(withHeader([{ label: "Lamps", href: "", children: [{ label: "Desk lamps", href: "/collections/desk" }] }]));
    expect(themeStrings(parsed)).toEqual(expect.arrayContaining(["Lamps", "Desk lamps"]));
    const de = translateTheme(parsed, { Lamps: "Lampen", "Desk lamps": "Schreibtischlampen" });
    expect(de.menus.header[0]).toEqual({ label: "Lampen", href: "", children: [{ label: "Schreibtischlampen", href: "/collections/desk" }] });
  });
});
