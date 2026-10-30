import { describe, expect, it } from "vitest";
import { ANNOUNCE_MAX, announcementMessages, defaultTheme, parseTheme, sectionDefaults, themeStrings } from "../src";

describe("announcement bar messages that take turns", () => {
  const doc = defaultTheme("Shop");
  const bar = (settings: unknown) => ({ ...doc, home: [{ id: "announce1", type: "announcement", hidden: false, settings }] });

  it("keeps old one-message bars as they were", () => {
    expect(sectionDefaults("announcement")).toEqual({ text: "", link: "", more: [], seconds: 5 });
    const parsed = parseTheme(bar({ text: "Free shipping over $50" })).home[0]!;
    expect(parsed.settings).toEqual({ text: "Free shipping over $50", link: "", more: [], seconds: 5 });
    expect(announcementMessages(parsed.settings as never)).toEqual([{ text: "Free shipping over $50", link: "" }]);
  });

  it("shows the first message then the extra ones, skipping empty ones", () => {
    const parsed = parseTheme(bar({
      text: "",
      link: "",
      more: [{ text: " 30-day returns ", link: "/pages/returns" }, { text: "", link: "/collections/all" }, { text: "Gift wrap for $3", link: "" }],
      seconds: 8,
    })).home[0]!;
    expect(announcementMessages(parsed.settings as never)).toEqual([
      { text: "30-day returns", link: "/pages/returns" },
      { text: "Gift wrap for $3", link: "" },
    ]);
  });

  it("holds up to five messages with safe links and a sensible pace", () => {
    const one = { text: "Hi", link: "" };
    expect(() => parseTheme(bar({ text: "A", more: Array.from({ length: ANNOUNCE_MAX }, () => one) }))).toThrow(`up to ${ANNOUNCE_MAX} messages`);
    expect(() => parseTheme(bar({ text: "A", more: [{ text: "B", link: "javascript:alert(1)" }] }))).toThrow("Links must start with");
    expect(() => parseTheme(bar({ text: "A", seconds: 1 }))).toThrow();
    expect(() => parseTheme(bar({ text: "A", seconds: 60 }))).toThrow();
  });

  it("offers the extra messages for translation", () => {
    const parsed = parseTheme(bar({ text: "Free shipping", more: [{ text: "New lamps every week", link: "" }] }));
    expect(themeStrings(parsed)).toEqual(expect.arrayContaining(["Free shipping", "New lamps every week"]));
  });
});
