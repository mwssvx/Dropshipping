import { describe, expect, it } from "vitest";
import { collectionTabs, COLLECTION_TABS_MAX, defaultTheme, parseTheme, SECTION_LABELS, SECTION_TYPES, sectionDefaults } from "../src";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("collection tabs section", () => {
  it("holds up to five collections and how many products each tab shows", () => {
    expect(SECTION_TYPES).toContain("collection_tabs");
    expect(SECTION_LABELS.collection_tabs.name).toBe("Collection tabs");
    expect(sectionDefaults("collection_tabs")).toEqual({ heading: "", collectionIds: [], limit: 8 });
    const doc = defaultTheme("Shop");
    const tabs = (settings: Record<string, unknown>) => ({ ...doc, home: [{ id: "tabs0001", type: "collection_tabs", hidden: false, settings }] });
    const set = { heading: "Shop by room", collectionIds: [uuid(2), uuid(1)], limit: 4 };
    expect(parseTheme(tabs(set)).home[0]!.settings).toEqual(set);
    expect(() => parseTheme(tabs({ ...set, collectionIds: [1, 2, 3, 4, 5, 6].map(uuid) }))).toThrow("Pick up to 5 collections.");
    expect(() => parseTheme(tabs({ ...set, limit: 13 }))).toThrow();
  });

  it("keeps the picked order, or uses the first collections, and skips empty ones", () => {
    const listed = new Set(["a", "b", "c"]);
    const onSale = (id: string) => listed.has(id);
    const all = [
      { id: uuid(1), productIds: ["a"] },
      { id: uuid(2), productIds: ["gone"] },
      { id: uuid(3), productIds: ["b", "c"] },
    ];
    expect(collectionTabs([uuid(3), uuid(9), uuid(1)], all, onSale).map((c) => c.id)).toEqual([uuid(3), uuid(1)]);
    expect(collectionTabs([], all, onSale).map((c) => c.id)).toEqual([uuid(1), uuid(3)]);
    const many = Array.from({ length: 8 }, (_, i) => ({ id: uuid(i + 10), productIds: ["a"] }));
    expect(collectionTabs([], many, onSale)).toHaveLength(COLLECTION_TABS_MAX);
    expect(collectionTabs([uuid(2)], all, onSale)).toEqual([]);
  });
});
