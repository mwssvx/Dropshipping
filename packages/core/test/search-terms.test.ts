import { describe, expect, it } from "vitest";
import { DemoModel, pruneEvents, recordSearch, searchReport, searchTerm } from "../src";
import { makeFixture } from "../evals/fixture";

const DAY = 86_400_000;

describe("what shoppers search for", () => {
  it("keeps only the words, and nothing that looks personal", () => {
    expect(searchTerm("  Sunset   LAMP ")).toBe("sunset lamp");
    expect(searchTerm("a")).toBeNull();
    expect(searchTerm("ada@example.com")).toBeNull();
    expect(searchTerm("order 100234")).toBeNull();
    expect(searchTerm("+1 512 555 0199")).toBeNull();
    expect(searchTerm("usb c cable 2m")).toBe("usb c cable 2m");
    expect(searchTerm("x".repeat(81))).toBeNull();
  });

  it("counts searches by day, reports the most searched and those that found nothing", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const now = new Date("2026-10-11T12:00:00Z");
    const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);
    for (let i = 0; i < 3; i++) await recordSearch(f.db, shop.id, "Lamp", 2, daysAgo(1));
    await recordSearch(f.db, shop.id, "lamp ", 2, now);
    await recordSearch(f.db, shop.id, "lamp shade", 0, daysAgo(2));
    await recordSearch(f.db, shop.id, "lamp shade", 0, now);
    // Nothing until a product was added: the latest day's count is what shows.
    await recordSearch(f.db, shop.id, "night light", 0, daysAgo(3));
    await recordSearch(f.db, shop.id, "night light", 1, now);
    expect(await recordSearch(f.db, shop.id, "me@example.com", 0, now)).toBe(false);
    // Too long ago for the report.
    await recordSearch(f.db, shop.id, "candle", 0, daysAgo(40));

    const report = await searchReport(f.db, shop.id, { from: daysAgo(30), to: new Date(now.getTime() + DAY) });
    expect(report.searches).toBe(8);
    expect(report.top).toEqual([
      { term: "lamp", searches: 4, results: 2 },
      { term: "lamp shade", searches: 2, results: 0 },
      { term: "night light", searches: 2, results: 1 },
    ]);
    expect(report.nothing).toEqual([{ term: "lamp shade", searches: 2, results: 0 }]);
    expect(report.nothingShare).toBe(0.25);

    // Old counts go with old visitor events.
    await recordSearch(f.db, shop.id, "candle", 0, daysAgo(500));
    expect(await pruneEvents(f.db, now)).toBeGreaterThanOrEqual(1);
    const all = await searchReport(f.db, shop.id, { from: daysAgo(1000), to: now });
    expect(all.top.find((t) => t.term === "candle")?.searches).toBe(1);
  });
});
