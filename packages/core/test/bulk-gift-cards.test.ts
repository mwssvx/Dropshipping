import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { BULK_GIFT_CARD_MAX, checkBulkGiftCards, DemoModel, findGiftCard, issueBulkGiftCards, parseBulkGiftCards, sendScheduledGiftCards } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const codeIn = (text: string) => /Gift card code: (\S+)/.exec(text)![1]!;

describe("gift cards for many people", () => {
  it("reads pasted rows from a spreadsheet, a CSV or a list", () => {
    // Copied from a spreadsheet, with its heading row.
    expect(parseBulkGiftCards("Email\tAmount\tName\nSam@Example.com\t$50\tSam Lee\nalex@example.com\t25.50\t\n")).toEqual([
      { email: "sam@example.com", amountMinor: 5000, name: "Sam Lee" },
      { email: "alex@example.com", amountMinor: 2550, name: null },
    ]);
    // Commas, quotes, semicolons and decimal commas.
    expect(parseBulkGiftCards('kim@example.com, 100, "Kim, the boss"\n\nlou@example.com;25,50;Lou')).toEqual([
      { email: "kim@example.com", amountMinor: 10000, name: "Kim, the boss" },
      { email: "lou@example.com", amountMinor: 2550, name: "Lou" },
    ]);
    expect(() => parseBulkGiftCards("Email,Amount\n")).toThrow("Paste at least one row");
    expect(() => parseBulkGiftCards("sam@example.com, 50\nnot-an-email, 20")).toThrow('Row 2: "not-an-email" isn\'t an email.');
    expect(() => parseBulkGiftCards("sam@example.com, fifty")).toThrow("Row 1: enter the amount like 50 or 25.00.");
    expect(() => parseBulkGiftCards("sam@example.com, 0.50")).toThrow("Row 1: gift cards go from 1.00 to 10,000.00.");
    expect(() => parseBulkGiftCards(Array.from({ length: BULK_GIFT_CARD_MAX + 1 }, (_, i) => `p${i}@example.com, 10`).join("\n"))).toThrow("up to 500");
    expect(() => checkBulkGiftCards({ rows: "sam@example.com, 50", sendOn: "2026-02-30" })).toThrow("Pick the day");
    expect(checkBulkGiftCards({ rows: "sam@example.com, 50\nalex@example.com, 25", from: " Acme Inc " })).toMatchObject({ from: "Acme Inc", totalMinor: 7500, scheduledFor: null });
  });

  it("emails each person their own code now, or on the day picked as a gift from the company", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const gc = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example" };

    const now = await issueBulkGiftCards(gc, shop, { rows: "sam@example.com, 50, Sam\nalex@example.com, 25", message: "Thanks for a great year!" });
    expect(now).toMatchObject({ issued: 2, sent: 2, totalMinor: 7500, scheduledFor: null });
    const toSam = f.mailer.sent.find((m) => m.to === "sam@example.com")!;
    expect(toSam.subject).toBe("Your $50.00 gift card for Glow Lamps");
    expect(toSam.text).toContain("Note: Thanks for a great year!");
    const toAlex = f.mailer.sent.find((m) => m.to === "alex@example.com")!;
    expect(codeIn(toAlex.text)).not.toBe(codeIn(toSam.text));
    expect((await findGiftCard(f.db, shop, codeIn(toAlex.text))).balanceMinor).toBe(2500);

    // From a company, on a day ahead: nothing goes out until that morning.
    const sendOn = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10);
    const later = await issueBulkGiftCards(gc, shop, { rows: "kim@example.com, 100, Kim\nlou@example.com, 100", from: "Acme Inc", message: "Happy holidays!", sendOn });
    expect(later).toMatchObject({ issued: 2, sent: 0, totalMinor: 20000 });
    expect(f.mailer.sent.some((m) => m.to === "kim@example.com")).toBe(false);
    const kimCard = await f.db.query.giftCards.findFirst({ where: eq(schema.giftCards.email, "kim@example.com") });
    expect(kimCard).toMatchObject({ recipientName: "Kim", fromName: "Acme Inc", note: "Happy holidays!", sentAt: null });
    expect(await sendScheduledGiftCards(gc, { now: new Date(`${sendOn}T07:00:00Z`) })).toEqual({ sent: 2 });
    const toKim = f.mailer.sent.find((m) => m.to === "kim@example.com")!;
    expect(toKim.subject).toBe("Acme Inc sent you a $100.00 gift card for Glow Lamps");
    expect(toKim.text).toContain("Hi Kim,\n\nAcme Inc sent you a gift card for Glow Lamps.");
    expect(toKim.text).toContain("Message from Acme Inc: Happy holidays!");
    expect(f.mailer.sent.find((m) => m.to === "lou@example.com")!.text).toMatch(/^Hi,\n/);
    expect((await findGiftCard(f.db, shop, codeIn(toKim.text))).balanceMinor).toBe(10000);
  });
});
