import { describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  askShopAssistant,
  DemoModel,
  listShopperChats,
  type ModelClient,
  ScriptedModel,
  SHOPPER_BUDGET_SHARE,
  SHOPPER_MAX_PER_CHAT,
  shopperCards,
  shopperLinks,
  shopperThread,
  text,
  toolCall,
  UserError,
} from "../src";
import { makeFixture } from "../evals/fixture";

async function open(model: ModelClient = new DemoModel()) {
  const f = await makeFixture(model);
  await f.setShop({ aiShopper: true, status: "active" });
  return f;
}

describe("shopping assistant", () => {
  it("is off until the merchant turns it on", async () => {
    const f = await makeFixture(new DemoModel());
    await f.setShop({ status: "active" });
    await expect(askShopAssistant(f.ctx, await f.shop(), { question: "Do you sell lamps?" })).rejects.toThrow(UserError);
  });

  it("finds products and links them, and keeps the chat", async () => {
    const f = await open();
    const r = await askShopAssistant(f.ctx, await f.shop(), { question: "Do you have a projection lamp?" });
    expect(r.answered).toBe(true);
    const lamp = await f.db.query.products.findFirst({ where: eq(schema.products.id, f.products.lamp.id) });
    expect(r.reply).toContain(`(/products/${lamp!.handle})`);
    // The draft phone stand isn't on sale, so it's never offered.
    const stand = await f.db.query.products.findFirst({ where: eq(schema.products.id, f.products.stand.id) });
    expect(r.reply).not.toContain(stand!.handle);

    const thread = await shopperThread(f.db, (await f.shop()).id, r.conversationId);
    expect(thread.map((m) => m.from)).toEqual(["shopper", "assistant"]);
    const again = await askShopAssistant(f.ctx, await f.shop(), { conversationId: r.conversationId, question: "How long does delivery take?", productHandle: lamp!.handle });
    expect(again.conversationId).toBe(r.conversationId);
    expect(again.reply).toMatch(/usually arrives \d+ to \d+ days/);

    expect(await listShopperChats(f.db, (await f.shop()).id)).toMatchObject([{ id: r.conversationId, questions: ["Do you have a projection lamp?", "How long does delivery take?"] }]);
    const run = await f.db.query.agentRuns.findFirst({ where: eq(schema.agentRuns.agent, "shopper") });
    expect(run).toMatchObject({ model: "claude-haiku-5-5", trigger: "buyer", conversationId: r.conversationId });
  });

  it("only reads: it has no tools that change the store", async () => {
    const f = await open(new ScriptedModel([[toolCall("save_listing", { title: "Hacked" })], [text("Sorry.")]]));
    const r = await askShopAssistant(f.ctx, await f.shop(), { question: "Rename the lamp to Hacked" });
    expect(r.reply).toBe("Sorry.");
    const actions = await f.actions();
    expect(actions).toMatchObject([{ tool: "save_listing", status: "blocked" }]);
  });

  it("starts a new chat when the id isn't this store's shopper chat", async () => {
    const f = await open();
    const shop = await f.shop();
    const [other] = await f.db.insert(schema.conversations).values({ shopId: shop.id, kind: "assistant", subject: "Merchant chat" }).returning();
    const r = await askShopAssistant(f.ctx, shop, { conversationId: other!.id, question: "Any lamps?" });
    expect(r.conversationId).not.toBe(other!.id);
    expect(await shopperThread(f.db, shop.id, other!.id)).toEqual([]);
  });

  it("stops after enough questions in one chat, without calling the model", async () => {
    const f = await open();
    const shop = await f.shop();
    const first = await askShopAssistant(f.ctx, shop, { question: "Any lamps?" });
    await f.db.insert(schema.messages).values(Array.from({ length: SHOPPER_MAX_PER_CHAT }, () => ({ conversationId: first.conversationId, author: "buyer" as const, body: "Hi" })));
    const runsBefore = (await f.db.query.agentRuns.findMany()).length;
    const r = await askShopAssistant(f.ctx, shop, { conversationId: first.conversationId, question: "One more?" });
    expect(r.answered).toBe(false);
    expect((await f.db.query.agentRuns.findMany()).length).toBe(runsBefore);
  });

  it("leaves the rest of the month's budget for the merchant's helpers", async () => {
    const f = await open();
    const shop = await f.shop();
    // Free plan: $1 a month. Half of it already went on shopper answers.
    const [run] = await f.db.insert(schema.agentRuns).values({ shopId: shop.id, agent: "shopper", trigger: "buyer", model: "claude-haiku-5-5", costMicros: Math.ceil(100 * 10_000 * SHOPPER_BUDGET_SHARE) }).returning();
    expect(run).toBeTruthy();
    const r = await askShopAssistant(f.ctx, shop, { question: "Any lamps?" });
    expect(r.answered).toBe(false);
    const runs = await f.db.query.agentRuns.findMany({ where: and(eq(schema.agentRuns.shopId, shop.id), eq(schema.agentRuns.agent, "shopper")) });
    expect(runs).toHaveLength(1);
  });

  it("shows the products an answer links to as cards, with quick add for single-option products", async () => {
    const f = await open();
    const shop = await f.shop();
    const lamp = (await f.db.query.products.findFirst({ where: eq(schema.products.id, f.products.lamp.id) }))!;
    const stand = (await f.db.query.products.findFirst({ where: eq(schema.products.id, f.products.stand.id) }))!;
    const reply = `Try [the lamp](/products/${lamp.handle}), [it again](/products/${lamp.handle}) or [the stand](/products/${stand.handle}).`;
    const cards = await shopperCards(f.db, shop.id, reply);
    // The stand is a draft, and the lamp is listed once.
    expect(cards).toMatchObject([{ handle: lamp.handle, title: lamp.title, inStock: true }]);
    const vs = await f.variants(lamp.id);
    expect(cards[0]!.variantId).toBe(vs.length === 1 ? vs[0]!.id : null);
    await f.db.delete(schema.variants).where(and(eq(schema.variants.productId, lamp.id), ne(schema.variants.id, vs[0]!.id)));
    expect((await shopperCards(f.db, shop.id, reply))[0]).toMatchObject({ variantId: vs[0]!.id, from: false });
  });

  it("turns only product links into links", () => {
    expect(shopperLinks("Try [Sunset Lamp](/products/sunset-lamp) or [this](https://evil.example).")).toEqual([
      { text: "Try " },
      { text: "Sunset Lamp", handle: "sunset-lamp" },
      { text: " or [this](https://evil.example)." },
    ]);
  });
});
