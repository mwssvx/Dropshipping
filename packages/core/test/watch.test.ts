import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, listAiReports, runScheduledAgents, runStoreWatch, storeSignals, todaySummary } from "../src";
import { DAY, makeFixture, type Fixture } from "../evals/fixture";

const NOW = new Date("2026-11-04T07:00:00Z");
const YESTERDAY = new Date("2026-11-03T12:00:00Z");

/** `perDay` paid orders on each of the 28 days before yesterday, and `yesterday` orders yesterday. */
async function history(f: Fixture, perDay: number, yesterday: number) {
  const at: Date[] = [];
  for (let d = 2; d <= 29; d++) for (let k = 0; k < perDay; k++) at.push(new Date(YESTERDAY.getTime() - (d - 1) * DAY));
  for (let k = 0; k < yesterday; k++) at.push(YESTERDAY);
  for (const t of at) {
    const o = await f.waitingOrder();
    await f.db.update(schema.orders).set({ paidAt: t }).where(eq(schema.orders.id, o.id));
  }
}

describe("the daily store watch", () => {
  it("stays quiet on a normal day and in a small store", async () => {
    const f = await makeFixture(new DemoModel());
    await history(f, 1, 0);
    // One order a day is too few to call a quiet day a drop.
    expect(await storeSignals(f.db, await f.shop(), NOW)).toEqual([]);
  });

  it("flags sales falling well below the store's normal", async () => {
    const f = await makeFixture(new DemoModel());
    await history(f, 2, 0);
    const [s] = await storeSignals(f.db, await f.shop(), NOW);
    expect(s).toMatchObject({ kind: "sales_drop", tone: "high" });
    expect(s!.headline).toMatch(/^Sales were \$0\.00 yesterday, 100% below the usual \$[\d.]+ a day\.$/);
  });

  it("flags a good day too, with what sold", async () => {
    const f = await makeFixture(new DemoModel());
    await history(f, 1, 4);
    const [s] = await storeSignals(f.db, await f.shop(), NOW);
    expect(s).toMatchObject({ kind: "sales_jump", tone: "good" });
    expect(s!.headline).toContain("led by");
  });

  it("explains what moved, saves it once a day, and shows it on Today", async () => {
    const f = await makeFixture(new DemoModel());
    await history(f, 2, 0);
    const shop = await f.shop();
    const run = await runStoreWatch(f.ctx, shop, NOW);
    expect(run!.status).toBe("done");
    const [report] = await listAiReports(f.db, shop.id, "watch");
    expect(report!.items[0]).toMatchObject({ impact: "high", area: "sales" });
    expect(report!.items[0]!.finding).toContain("below the usual");
    expect((await f.db.query.agentRuns.findFirst({ where: eq(schema.agentRuns.id, run!.runId) }))!.model).toBe("claude-haiku-5-5");
    // Once a day.
    expect(await runStoreWatch(f.ctx, shop, NOW)).toBeNull();
    const today = await todaySummary(f.db, shop, NOW);
    expect(today.attention.find((a) => a.kind === "watch")).toMatchObject({ tone: "critical", url: "/insights" });
  });

  it("runs from the daily job only for stores that keep it on, and never on a quiet day", async () => {
    const f = await makeFixture(new DemoModel());
    expect((await runScheduledAgents(f.ctx, NOW)).storeWatches).toBe(0);
    expect(await f.db.query.agentRuns.findMany({ where: eq(schema.agentRuns.agent, "watch") })).toHaveLength(0);
    await history(f, 2, 0);
    await f.setShop({ aiDailyWatch: false });
    expect((await runScheduledAgents(f.ctx, NOW)).storeWatches).toBe(0);
    await f.setShop({ aiDailyWatch: true });
    expect((await runScheduledAgents(f.ctx, NOW)).storeWatches).toBe(1);
  });
});
