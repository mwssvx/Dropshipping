import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { askAssistant, atRiskCustomers, AT_RISK_TAG, decideAction, DemoModel } from "../src";
import { DAY, makeFixture, type Fixture } from "../evals/fixture";

const NOW = new Date("2026-11-04T07:00:00Z");

/** A buyer with orders `daysAgo` before NOW. */
async function buyer(f: Fixture, email: string, daysAgo: number[], o: { name?: string; subscribed?: boolean } = {}) {
  const shop = await f.shop();
  await f.db.insert(schema.customers).values({ shopId: shop.id, email, name: o.name ?? null, acceptsMarketing: o.subscribed ?? true });
  for (const d of daysAgo) {
    const order = await f.order(f.products.lamp.id);
    await f.db.update(schema.orders).set({ email, paidAt: new Date(NOW.getTime() - d * DAY) }).where(eq(schema.orders.id, order.id));
  }
}

describe("regulars who may be slipping away", () => {
  it("measures each buyer against their own rhythm", async () => {
    const f = await makeFixture(new DemoModel());
    // Every 10 days, now 40 days since: at risk.
    await buyer(f, "ann@example.com", [60, 50, 40], { name: "Ann Lee" });
    // Every 60 days, 40 days since: on time.
    await buyer(f, "bo@example.com", [160, 100, 40]);
    // Ordered once: not a regular yet.
    await buyer(f, "cy@example.com", [90]);
    // Every 10 days but 400 days ago: already gone.
    await buyer(f, "di@example.com", [420, 410, 400]);
    const rows = await atRiskCustomers(f.db, (await f.shop()).id, NOW);
    expect(rows.map((r) => [r.email, r.usualGapDays, r.daysSince, r.orders])).toEqual([["ann@example.com", 10, 40, 3]]);
  });

  it("in demo mode, drafts a win-back email for the owner's OK, then tags them and saves the draft", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    // Real time, since the Assistant looks from today.
    const now = Date.now();
    await f.db.insert(schema.customers).values({ shopId: shop.id, email: "ann@example.com", name: "Ann Lee", acceptsMarketing: true });
    for (const d of [70, 55, 40]) {
      const order = await f.order(f.products.lamp.id);
      await f.db.update(schema.orders).set({ email: "ann@example.com", paidAt: new Date(now - d * DAY) }).where(eq(schema.orders.id, order.id));
    }
    const look = await askAssistant(f.ctx, shop, "Which regulars stopped buying?");
    expect(look.text).toContain("1 regular is past their usual time to order");
    expect(look.text).toContain("Ann: usually every 15 days, last ordered 40 days ago");

    await askAssistant(f.ctx, shop, "Yes, draft a win-back email");
    const [p] = await f.pending();
    expect(p).toMatchObject({ tool: "draft_winback_email", summary: "Win-back email draft: “We miss you, and we've got something new”" });
    expect((p!.input.preview as string[])[0]).toBe("1 regular is past their usual time to order; 1 said yes to emails and would get it.");
    expect(await f.db.query.campaigns.findFirst({ where: eq(schema.campaigns.shopId, shop.id) })).toBeUndefined();

    await decideAction(f.ctx, shop.id, p!.id, { approve: true, by: "owner" });
    const ann = await f.db.query.customers.findFirst({ where: eq(schema.customers.email, "ann@example.com") });
    expect(ann!.tags).toContain(AT_RISK_TAG);
    const c = await f.db.query.campaigns.findFirst({ where: eq(schema.campaigns.shopId, shop.id) });
    expect(c).toMatchObject({ audience: "tagged", audienceTag: AT_RISK_TAG, subject: "We miss you, and we've got something new" });
    expect(c!.status).toBe("draft");
  });
});
