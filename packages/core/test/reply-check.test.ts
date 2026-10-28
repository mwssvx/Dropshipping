import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { checkReply, DemoModel, getConversation, handleBuyerMessage, ScriptedModel, text, toolCall, type ModelRequest } from "../src";
import { makeFixture } from "../evals/fixture";

const script = () =>
  new ScriptedModel([
    [toolCall("read_order", {})],
    [toolCall("send_reply", { topic: "order_status", message: "Hi Ada, your order will arrive on Friday the 14th. Glow Lamps" })],
    [text("Replied.")],
  ]);

describe("the second check on buyer replies", () => {
  it("holds a reply the checker doesn't trust, as a draft for the owner", async () => {
    const model = script();
    const seen: ModelRequest[] = [];
    model.checker = (req) => {
      seen.push(req);
      return { safe: false, problems: ["the delivery date isn't in the order data"] };
    };
    const f = await makeFixture(model);
    await f.setShop({ aiAutoReplyTopics: ["order_status"] });
    const order = await f.shippedOrder();
    const sent = f.mailer.sent.length;
    const h = await handleBuyerMessage(f.ctx, { shopId: order.shopId, paymentIntentId: order.paymentIntentId!, body: "When will it arrive?" });
    await h.run();

    expect(f.mailer.sent.length).toBe(sent);
    expect((await f.pending())[0]).toMatchObject({ tool: "send_reply", reason: "A second check held it: the delivery date isn't in the order data." });
    const { conversation, messages } = await getConversation(f.db, order.shopId, h.conversationId);
    expect(conversation.status).toBe("needs_merchant");
    expect(messages.at(-1)).toMatchObject({ author: "agent", status: "draft" });

    // The checker saw the buyer's question, what the helper read, and the reply.
    const prompt = String(seen[0]!.messages[0]!.content);
    expect(prompt).toContain("When will it arrive?");
    expect(prompt).toContain("Friday the 14th");
    const runs = await f.db.query.agentRuns.findMany({ where: eq(schema.agentRuns.agent, "reply_checker") });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: "event", conversationId: h.conversationId, status: "done" });
  });

  it("lets a reply it trusts go out on its own", async () => {
    const f = await makeFixture(script());
    await f.setShop({ aiAutoReplyTopics: ["order_status"] });
    const order = await f.shippedOrder();
    const h = await handleBuyerMessage(f.ctx, { shopId: order.shopId, paymentIntentId: order.paymentIntentId!, body: "When will it arrive?" });
    await h.run();
    expect(f.mailer.sent.at(-1)!.text).toContain("Friday the 14th");
    expect(await f.pending()).toHaveLength(0);
  });

  it("holds the reply when the check can't run", async () => {
    const model = script();
    model.checker = () => {
      throw new Error("overloaded");
    };
    const f = await makeFixture(model);
    await f.setShop({ aiAutoReplyTopics: ["order_status"] });
    const order = await f.shippedOrder();
    const sent = f.mailer.sent.length;
    const h = await handleBuyerMessage(f.ctx, { shopId: order.shopId, paymentIntentId: order.paymentIntentId!, body: "When will it arrive?" });
    await h.run();
    expect(f.mailer.sent.length).toBe(sent);
    expect((await f.pending())[0]!.reason).toBe("The second check didn't finish, so it waits for you.");
  });

  it("in demo mode, catches numbers that aren't in the order", async () => {
    const f = await makeFixture(new DemoModel());
    const order = await f.shippedOrder();
    const shop = await f.shop();
    const h = await handleBuyerMessage(f.ctx, { shopId: order.shopId, paymentIntentId: order.paymentIntentId!, body: "Where is it?" });
    const run = { ctx: f.ctx, shop, runId: "x", agent: "buyer_support" as const, conversationId: h.conversationId, orderId: order.id, productId: null, facts: [JSON.stringify({ number: 1042, tracking: "DS20488" })] };
    expect(await checkReply(run, "Hi Ada, order 1042 is on its way, tracking DS20488. Glow Lamps")).toBeNull();
    expect(await checkReply(run, "Hi Ada, tracking DS99731, it arrives in 3 days. Glow Lamps")).toBe(
      'A second check held it: the reply has "99731", which isn\'t in the order or policies (don\'t invent numbers, codes or specs).',
    );
    // It runs on the small model.
    const runs = await f.db.query.agentRuns.findMany({ where: eq(schema.agentRuns.agent, "reply_checker") });
    expect(runs.map((r) => r.model)).toEqual(["claude-haiku-5-5", "claude-haiku-5-5"]);
  });
});
