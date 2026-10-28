import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { askAssistant, DemoModel, recordSearch } from "../src";
import { makeFixture } from "../evals/fixture";

const tools = async (f: Awaited<ReturnType<typeof makeFixture>>) => (await f.actions()).map((a) => a.tool);

describe("the assistant's store insights", () => {
  it("says what's selling, from paid orders", async () => {
    const f = await makeFixture(new DemoModel());
    await f.waitingOrder();
    const a = await askAssistant(f.ctx, await f.shop(), "What's selling best?");
    expect(await tools(f)).toEqual(["read_sales"]);
    expect(a.text).toMatch(/1 order/);
    expect(a.text).toContain("Sunset Projection Lamp (1 sold");
  });

  it("finds what shoppers searched for and didn't find", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await recordSearch(f.db, shop.id, "desk lamp", 2);
    await recordSearch(f.db, shop.id, "night light", 0);
    await recordSearch(f.db, shop.id, "night light", 0);
    const a = await askAssistant(f.ctx, shop, "What are shoppers searching for?");
    expect(await tools(f)).toEqual(["read_shopper_interest"]);
    expect(a.text).toContain("night light: 2 searches");
    const action = await f.db.query.agentActions.findFirst({ where: eq(schema.agentActions.tool, "read_shopper_interest") });
    expect(action!.status).toBe("done");
  });

  it("explains a supplier-only store has no stock of its own", async () => {
    const f = await makeFixture(new DemoModel());
    const a = await askAssistant(f.ctx, await f.shop(), "Am I running low on stock?");
    expect(await tools(f)).toEqual(["read_stock"]);
    expect(a.text).toMatch(/ship from suppliers/);
  });
});
