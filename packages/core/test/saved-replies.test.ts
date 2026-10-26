import { describe, expect, it } from "vitest";
import {
  addStarterReplies, createShop, deleteSavedReply, DemoModel, exportStore, getConversation, importStore, signUp, listSavedReplies, MAX_SAVED_REPLIES, merchantReply, savedRepliesFor, saveSavedReply,
  sendContactMessage, startBuyerMessage, STARTER_REPLIES,
} from "../src";
import { makeFixture } from "../evals/fixture";

describe("saved replies", () => {
  it("are kept per store with unique names, up to a limit", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await expect(saveSavedReply(f.db, shop.id, { title: " ", body: "Hello" })).rejects.toThrow("short name");
    await expect(saveSavedReply(f.db, shop.id, { title: "Hi", body: "x".repeat(2001) })).rejects.toThrow("under 2,000");
    const first = await saveSavedReply(f.db, shop.id, { title: "Thanks", body: "Thanks for your order, {first_name}!" });
    await expect(saveSavedReply(f.db, shop.id, { title: "thanks ", body: "Again" })).rejects.toThrow('already have a reply called "thanks"');
    // Changing a reply keeps its id, and it may keep its own name.
    const changed = await saveSavedReply(f.db, shop.id, { id: first.id, title: "Thanks", body: "Thank you, {first_name}!" });
    expect(changed).toMatchObject({ id: first.id, body: "Thank you, {first_name}!" });

    // Starters are added once, and skip names the store already uses.
    await saveSavedReply(f.db, shop.id, { title: "Returns", body: "Our own returns answer." });
    expect(await addStarterReplies(f.db, shop.id)).toBe(STARTER_REPLIES.length - 1);
    expect(await addStarterReplies(f.db, shop.id)).toBe(0);
    const all = await listSavedReplies(f.db, shop.id);
    expect(all.map((r) => r.title)).toEqual(["How long shipping takes", "Returns", "Thanks", "Where is my order"]);
    expect(all.find((r) => r.title === "Returns")!.body).toBe("Our own returns answer.");

    for (let i = all.length; i < MAX_SAVED_REPLIES; i++) await saveSavedReply(f.db, shop.id, { title: `Reply ${i}`, body: "Hello there" });
    await expect(saveSavedReply(f.db, shop.id, { title: "One too many", body: "Hello there" })).rejects.toThrow(`up to ${MAX_SAVED_REPLIES}`);
    await deleteSavedReply(f.db, shop.id, first.id);
    expect(await listSavedReplies(f.db, shop.id)).toHaveLength(MAX_SAVED_REPLIES - 1);
  });

  it("fill in the buyer, order and tracking, and can't go out with a field left over", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await addStarterReplies(f.db, shop.id);
    const where = (rows: Awaited<ReturnType<typeof savedRepliesFor>>) => rows.find((r) => r.title === "Where is my order")!;

    // Shipped: everything fills in.
    const shipped = await f.shippedOrder();
    const asked = await startBuyerMessage(f.db, { shopId: shop.id, paymentIntentId: shipped.paymentIntentId!, body: "Where is my lamp?" });
    const filled = where(await savedRepliesFor(f.db, shop.id, asked.conversation.id));
    expect(filled.missing).toEqual([]);
    expect(filled.text).toMatch(new RegExp(`^Hi Ada,\\n\\nThanks for waiting\\. Order #${shipped.number} is on its way, and you can follow it here: \\S+\\n`));

    // Not shipped yet: the tracking link stays in braces and the reply is refused until it's replaced.
    const waiting = await f.waitingOrder();
    const early = await startBuyerMessage(f.db, { shopId: shop.id, paymentIntentId: waiting.paymentIntentId!, body: "Has it shipped?" });
    const draft = where(await savedRepliesFor(f.db, shop.id, early.conversation.id));
    expect(draft.missing).toEqual(["{tracking_link}"]);
    expect(draft.text).toContain(`Order #${waiting.number} is on its way`);
    await expect(merchantReply(f.ctx, shop.id, early.conversation.id, draft.text)).rejects.toThrow("Replace {tracking_link} in the reply first");
    // Nothing was stored or sent, and the buyer's question is still waiting.
    const before = f.mailer.sent.length;
    expect((await getConversation(f.db, shop.id, early.conversation.id)).messages.filter((m) => m.author === "merchant")).toHaveLength(0);
    expect(await merchantReply(f.ctx, shop.id, early.conversation.id, draft.text.replace(" and you can follow it here: {tracking_link}", ""))).toEqual({ status: "sent" });
    expect(f.mailer.sent).toHaveLength(before + 1);

    // A contact-page message: the name they gave, no order.
    const contact = await sendContactMessage(f.db, shop, { name: "Grace Hopper", email: "grace@example.com", message: "Do you ship to Canada?" });
    const shipping = (await savedRepliesFor(f.db, shop.id, contact!.conversationId)).find((r) => r.title === "How long shipping takes")!;
    expect(shipping.text.startsWith("Hi Grace,")).toBe(true);
    expect(shipping.missing).toEqual(["{order_number}"]);
  });

  it("travel with the store file", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await addStarterReplies(f.db, shop.id);
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.saved_replies.map((r: { title: string }) => r.title)).toEqual(["How long shipping takes", "Returns", "Where is my order"]);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await saveSavedReply(f.db, copy.id, { title: "Returns", body: "The copy's own answer." });
    // A name the store already uses is left as it is.
    expect((await importStore(f.db, copy.id, file)).savedReplies).toBe(2);
    expect((await listSavedReplies(f.db, copy.id)).find((r) => r.title === "Returns")!.body).toBe("The copy's own answer.");
  });
});
