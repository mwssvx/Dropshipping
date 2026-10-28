import { describe, expect, it } from "vitest";
import { AGENT_SPECS, decideAction, DemoModel, exampleInstructions, handleBuyerMessage, learnFromEdit, merchantReply, REPLY_EXAMPLES_MAX, setAiSettings } from "../src";
import { makeFixture } from "../evals/fixture";

describe("the buyer helper learns from the owner's rewrites", () => {
  it("keeps the owner's version when they edit a draft before sending, and writes like it next time", async () => {
    const f = await makeFixture(new DemoModel());
    const order = await f.shippedOrder();
    const h = await handleBuyerMessage(f.ctx, { shopId: order.shopId, paymentIntentId: order.paymentIntentId!, body: "Hi, where is my order?" });
    await h.run();
    const [draft] = await f.pending();
    const mine = "Hey Ada! Good news, it's on its way to you now. Your tracking link is in your inbox. Cheers, the Glow Lamps team";
    await decideAction(f.ctx, order.shopId, draft!.id, { approve: true, by: "owner", message: mine });

    const shop = await f.shop();
    expect(shop.aiReplyExamples).toEqual([{ topic: "order_status", reply: mine, at: expect.any(String) }]);
    const system = AGENT_SPECS.buyer_support.system(shop);
    expect(system).toContain("The owner rewrote some of your earlier drafts");
    expect(system).toContain(`<owner_reply n="1" topic="order_status">\n${mine}\n</owner_reply>`);
    // The buyer's own words never go into the instructions.
    expect(system).not.toContain("where is my order");
    // The Assistant and other helpers don't get them.
    expect(AGENT_SPECS.assistant.system(shop)).not.toContain("owner_reply");
  });

  it("also learns when the owner writes their own reply over a draft, but not from an unchanged send", async () => {
    const f = await makeFixture(new DemoModel());
    const order = await f.shippedOrder();
    const h = await handleBuyerMessage(f.ctx, { shopId: order.shopId, paymentIntentId: order.paymentIntentId!, body: "Where is it?" });
    await h.run();
    const [draft] = await f.pending();
    await decideAction(f.ctx, order.shopId, draft!.id, { approve: true, by: "owner", message: String(draft!.input.message) });
    expect((await f.shop()).aiReplyExamples).toEqual([]);

    const again = await handleBuyerMessage(f.ctx, { shopId: order.shopId, paymentIntentId: order.paymentIntentId!, body: "Where is it now?" });
    await again.run();
    await merchantReply(f.ctx, order.shopId, again.conversationId, "Hi Ada, it should be with you by Friday. Shout if not! Glow Lamps");
    expect((await f.shop()).aiReplyExamples.map((x) => x.reply)).toEqual(["Hi Ada, it should be with you by Friday. Shout if not! Glow Lamps"]);
  });

  it("keeps only the latest few, and the owner can clear them", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    for (let i = 0; i < REPLY_EXAMPLES_MAX + 2; i++) await learnFromEdit(f.db, shop.id, { topic: "other", draft: "x", sent: `Reply number ${i}, written by the owner.` });
    const kept = (await f.shop()).aiReplyExamples;
    expect(kept).toHaveLength(REPLY_EXAMPLES_MAX);
    expect(kept[0]!.reply).toBe(`Reply number ${REPLY_EXAMPLES_MAX + 1}, written by the owner.`);
    await setAiSettings(f.db, shop, { replyExamples: [] });
    expect((await f.shop()).aiReplyExamples).toEqual([]);
    expect(exampleInstructions([])).toBe("");
  });
});
