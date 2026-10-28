import { describe, expect, it } from "vitest";
import { upcomingSaleDates } from "../src";

describe("sale dates ahead", () => {
  it("lists the next shopping dates for the store's country, with a sale's days around each", () => {
    expect(upcomingSaleDates("US", "2026-10-28")).toEqual([
      { id: "halloween", name: "Halloween", saleTitle: "Halloween sale", day: "2026-10-31", start: "2026-10-25", end: "2026-11-01" },
      { id: "singles-day", name: "Singles' Day", saleTitle: "11.11 sale", day: "2026-11-11", start: "2026-11-11", end: "2026-11-12" },
      // Thanksgiving is Nov 26 in 2026: Friday to Cyber Monday.
      { id: "black-friday", name: "Black Friday", saleTitle: "Black Friday sale", day: "2026-11-27", start: "2026-11-27", end: "2026-12-01" },
      { id: "after-christmas", name: "After Christmas", saleTitle: "After-Christmas sale", day: "2026-12-26", start: "2026-12-26", end: "2027-01-01" },
    ]);
    // Boxing Day in the UK, and next year's dates once this year's have passed.
    expect(upcomingSaleDates("GB", "2026-12-28", 3).map((d) => [d.id, d.day])).toEqual([
      ["boxing-day", "2026-12-26"],
      ["valentines", "2027-02-14"],
      // Mothering Sunday: three weeks before Easter (March 28, 2027).
      ["mothers-day", "2027-03-07"],
    ]);
    // Mother's Day in the US is the second Sunday of May; Father's Day is past the four months ahead in January.
    expect(upcomingSaleDates("US", "2027-01-10").map((d) => [d.id, d.day])).toEqual([["valentines", "2027-02-14"], ["mothers-day", "2027-05-09"]]);
    expect(upcomingSaleDates("AU", "2027-07-01").find((d) => d.id === "fathers-day")?.day).toBe("2027-09-05");
  });
});
