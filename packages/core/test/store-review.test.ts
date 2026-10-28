import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { customerReport, DemoModel, listAiReports, productFunnel, recordSearch, reviewStoreWithAi, runScheduledAgents, UserError } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const views = (shopId: string, productId: string, sessions: number, kind: "product_view" | "add_to_cart" = "product_view") =>
  Array.from({ length: sessions }, (_, i) => ({ shopId, productId, sessionId: `${kind}-${productId}-${i}`, kind }));

describe("the AI store review", () => {
  it("counts new, returning and lapsed buyers", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const a = await f.waitingOrder();
    const b = await f.waitingOrder();
    const old = await f.waitingOrder();
    // The same guest ordered twice; another buyer last ordered four months ago.
    await f.db.update(schema.orders).set({ customerId: null, email: "same@example.com" }).where(eq(schema.orders.id, a.id));
    await f.db.update(schema.orders).set({ customerId: null, email: "SAME@example.com", paidAt: new Date(Date.now() - 60 * DAY) }).where(eq(schema.orders.id, b.id));
    await f.db.update(schema.orders).set({ customerId: null, paidAt: new Date(Date.now() - 120 * DAY) }).where(eq(schema.orders.id, old.id));
    const r = await customerReport(f.db, shop.id, 30);
    expect(r).toMatchObject({ buyers: 1, newBuyers: 0, returningBuyers: 1, everBought: 2, repeatPercent: 50, lapsed: 1, orders: 1 });
    expect(r.topCountries[0]).toMatchObject({ country: "US", orders: 1 });
  });

  it("finds products people look at but don't add to the cart", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await f.db.insert(schema.storefrontEvents).values([...views(shop.id, f.products.projector.id, 25), ...views(shop.id, f.products.lamp.id, 12), ...views(shop.id, f.products.lamp.id, 6, "add_to_cart")]);
    const r = await productFunnel(f.db, shop.id, 30);
    expect(r.viewedNotAdded.map((p) => p.title)).toEqual(["Galaxy Projector"]);
    expect(r.viewedNotAdded[0]).toMatchObject({ views: 25, carts: 0, cartPercent: 0 });
  });

  it("saves a few suggestions backed by the numbers, on Sonnet", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await f.waitingOrder();
    await f.db.insert(schema.storefrontEvents).values(views(shop.id, f.products.projector.id, 30));
    await recordSearch(f.db, shop.id, "night light", 0);
    const run = await reviewStoreWithAi(f.ctx, shop);
    expect(run.status).toBe("done");
    expect((await f.actions()).map((a) => a.tool)).toEqual(["read_sales", "read_profit", "read_product_funnel", "read_customers", "read_returns", "read_shopper_interest", "save_review"]);
    expect(run.report!.summary).toMatch(/1 order/);
    const titles = run.report!.items.map((i) => i.title);
    expect(titles).toContain("Make “Galaxy Projector” easier to say yes to");
    expect(titles).toContain("Sell what shoppers search for");
    expect(run.report!.items.find((i) => i.area === "search")!.finding).toContain("night light");
    expect((await f.db.query.agentRuns.findFirst({ where: eq(schema.agentRuns.id, run.runId) }))!.model).toBe("claude-sonnet-5-5");
    expect(await listAiReports(f.db, shop.id, "review")).toHaveLength(1);
  });

  it("waits a while before the merchant asks again", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await reviewStoreWithAi(f.ctx, shop);
    await expect(reviewStoreWithAi(f.ctx, shop)).rejects.toThrow(UserError);
    expect(await f.db.query.agentRuns.findMany()).toHaveLength(1);
  });

  it("suggests getting found when there are no sales yet", async () => {
    const f = await makeFixture(new DemoModel());
    const run = await reviewStoreWithAi(f.ctx, await f.shop());
    expect(run.report!.summary).toMatch(/no orders/);
    expect(run.report!.items[0]).toMatchObject({ title: "Get your first visitors", area: "campaigns" });
  });

  it("runs every Monday for stores that turned it on", async () => {
    const f = await makeFixture(new DemoModel());
    const monday = new Date("2026-11-02T06:00:00Z");
    expect((await runScheduledAgents(f.ctx, monday)).storeReviews).toBe(0);
    await f.setShop({ aiWeeklyReview: true });
    expect((await runScheduledAgents(f.ctx, new Date("2026-11-03T06:00:00Z"))).storeReviews).toBe(0);
    expect((await runScheduledAgents(f.ctx, monday)).storeReviews).toBe(1);
    expect((await runScheduledAgents(f.ctx, monday)).storeReviews).toBe(0);
    const run = await f.db.query.agentRuns.findFirst({ where: eq(schema.agentRuns.agent, "analyst") });
    expect(run!.trigger).toBe("schedule");
  });
});
