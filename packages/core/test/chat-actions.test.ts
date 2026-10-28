import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { askAssistant, decideAction, DemoModel, ScriptedModel, text, toolCall } from "../src";
import { makeFixture } from "../evals/fixture";

const DAY = 86_400_000;
const discount = (over: Record<string, unknown> = {}) => ({ code: "spring15", kind: "percent", value: 15, min_order: null, days: 7, usage_limit: null, once_per_customer: false, ...over });

describe("discounts and collections from the chat", () => {
  it("proposes a discount with a preview, and creates it only once approved", async () => {
    const f = await makeFixture(new ScriptedModel([[toolCall("create_discount", discount())], [text("It's waiting for your OK.")]]));
    const shop = await f.shop();
    await askAssistant(f.ctx, shop, "Make a 15% code for spring, for a week");
    const [p] = await f.pending();
    expect(p).toMatchObject({ tool: "create_discount", summary: "New discount code SPRING15: 15% off" });
    const preview = p!.input.preview as string[];
    expect(preview[0]).toBe("Buyers who enter SPRING15 get 15% off everything.");
    expect(preview[1]).toMatch(/^It lasts 7 days from when you approve it/);
    expect(preview.at(-1)).toBe("Every product still makes money with the code.");
    expect(await f.db.query.discounts.findFirst({ where: eq(schema.discounts.shopId, shop.id) })).toBeUndefined();

    await decideAction(f.ctx, shop.id, p!.id, { approve: true, by: "owner" });
    const d = await f.db.query.discounts.findFirst({ where: and(eq(schema.discounts.shopId, shop.id), eq(schema.discounts.code, "SPRING15")) });
    expect(d).toMatchObject({ kind: "percent", value: 15, automatic: false });
    expect(Math.abs(d!.endsAt!.getTime() - (Date.now() + 7 * DAY))).toBeLessThan(60_000);
  });

  it("warns in the preview when products would sell at a loss, and refuses a code that's taken", async () => {
    const f = await makeFixture(
      new ScriptedModel([[toolCall("create_discount", discount({ code: "HALF", value: 90, days: null }))], [text("Waiting.")], [toolCall("create_discount", discount({ code: "half" }))], [text("Taken.")]]),
    );
    const shop = await f.shop();
    await askAssistant(f.ctx, shop, "90% off everything");
    const [p] = await f.pending();
    const preview = p!.input.preview as string[];
    expect(preview).toContain("It has no end date; you can end it any time under Discounts and offers.");
    expect(preview.at(-1)).toMatch(/^With the code, \d+ products? would sell at a loss: .*below what it costs you/);
    await decideAction(f.ctx, shop.id, p!.id, { approve: true, by: "owner" });
    await askAssistant(f.ctx, await f.shop(), "Again");
    const tries = (await f.actions()).filter((a) => a.tool === "create_discount");
    expect(tries.map((a) => [a.status, a.error])).toEqual([
      ["approved", null],
      ["failed", "The store already has a code called HALF; pick another."],
    ]);
  });

  it("in demo mode, makes a code and a collection from what the owner asks", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const run = await askAssistant(f.ctx, shop, "Create a discount code WELCOME10 for 10% off orders over $40 for 14 days");
    expect(run.text).toContain("waiting for your OK");
    const [code] = await f.pending();
    expect(code!.input).toMatchObject({ code: "WELCOME10", kind: "percent", value: 10, min_order: 40, days: 14 });
    expect((code!.input.preview as string[])[0]).toBe("Buyers who enter WELCOME10 get 10% off orders over $40.00.");

    await askAssistant(f.ctx, shop, "Make a collection of projector products called Night lights");
    const coll = (await f.pending()).find((a) => a.tool === "create_collection")!;
    expect(coll.summary).toBe("New collection “Night lights” with 1 product");
    expect((coll.input.preview as string[])[0]).toBe("1 product: Galaxy Projector.");
    await decideAction(f.ctx, shop.id, coll.id, { approve: true, by: "owner" });
    const c = await f.db.query.collections.findFirst({ where: eq(schema.collections.shopId, shop.id) });
    expect(c).toMatchObject({ title: "Night lights", handle: "night-lights" });
    expect(await f.db.query.collectionProducts.findMany({ where: eq(schema.collectionProducts.collectionId, c!.id) })).toHaveLength(1);
  });
});
