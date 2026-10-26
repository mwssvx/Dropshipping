import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { DemoModel, LogMailer, sendWeeklySummaries, setWeeklySummary, signUp, summaryWeek, weeklySummary } from "../src";
import { makeFixture } from "../evals/fixture";

const DAY = 86_400_000;

describe("Monday summary", () => {
  it("covers last Monday to Sunday", () => {
    // Wednesday Oct 28 2026: last week is Oct 19 to 25.
    const w = summaryWeek(new Date("2026-10-28T15:00:00Z"));
    expect(w).toMatchObject({ key: "2026-10-19", from: new Date("2026-10-19T00:00:00Z"), to: new Date("2026-10-26T00:00:00Z") });
    expect(w.before.from).toEqual(new Date("2026-10-12T00:00:00Z"));
    // On a Monday, the week that just ended.
    expect(summaryWeek(new Date("2026-10-26T00:30:00Z")).key).toBe("2026-10-19");
  });

  it("sums up the week for those who see the money, once, unless they turned it off", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const a = await f.waitingOrder();
    await f.outOfStockOrder();
    const nextWeek = new Date(Date.now() + 7 * DAY);

    const s = await weeklySummary(f.db, shop, nextWeek);
    expect(s.orders).toBe(2);
    expect(s.salesMinor).toBeGreaterThan(a.totalMinor);
    expect(s.salesChange).toBeNull();
    expect(s.top[0]).toMatchObject({ units: 1 });
    expect(s.waiting.map((w) => w.kind)).toEqual(["problems"]);
    expect(s.quiet).toBe(false);

    // An admin and a staff member: staff don't see sales, so they don't get it.
    const admin = await signUp(f.db, { email: "admin@example.com", password: "correct horse" });
    const staff = await signUp(f.db, { email: "staff@example.com", password: "correct horse" });
    await f.db.insert(schema.shopMembers).values([{ shopId: shop.id, userId: admin.id, role: "admin" }, { shopId: shop.id, userId: staff.id, role: "staff" }]);
    await setWeeklySummary(f.db, shop.id, admin.id, false);

    const mailer = new LogMailer(true);
    const ctx = { db: f.db, mailer, adminUrl: (p: string) => `https://app.example${p}` };
    expect(await sendWeeklySummaries(ctx, { now: nextWeek })).toEqual({ sent: 1 });
    expect(mailer.sent[0]!.to).toBe("owner@example.com");
    expect(mailer.sent[0]!.subject).toMatch(new RegExp(`^${shop.name} last week: \\$[\\d.,]+ from 2 orders$`));
    expect(mailer.sent[0]!.text).toContain("Orders: 2\n");
    expect(mailer.sent[0]!.text).toContain("Waiting for you:\n- 1 order needs you.");
    expect(mailer.sent[0]!.text).toContain("https://app.example/admin/account");
    // Once a week, however often the job runs.
    expect(await sendWeeklySummaries(ctx, { now: new Date(nextWeek.getTime() + 3_600_000) })).toEqual({ sent: 0 });
    // The week after: compared with this one, and the admin turned it back on.
    await setWeeklySummary(f.db, shop.id, admin.id, true);
    const later = await sendWeeklySummaries(ctx, { now: new Date(nextWeek.getTime() + 7 * DAY) });
    expect(later.sent).toBe(2);
    expect(mailer.sent.at(-1)!.text).toMatch(/Orders: 0 \(down 100% on the week before\)/);
  });

  it("stays quiet for a store with nothing to say", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const mailer = new LogMailer(true);
    expect(await sendWeeklySummaries({ db: f.db, mailer, adminUrl: (p) => p }, { now: new Date(Date.now() + 7 * DAY) })).toEqual({ sent: 0 });
    expect((await weeklySummary(f.db, shop, new Date(Date.now() + 7 * DAY))).quiet).toBe(true);
  });
});
