import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { countNeedsYou, DemoModel, getConversation, listInbox, merchantReply, sendContactMessage } from "../src";
import { makeFixture } from "../evals/fixture";

describe("contact page", () => {
  it("puts messages in the inbox and the merchant's reply goes out by email", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const send = (input: Partial<Parameters<typeof sendContactMessage>[2]>) =>
      sendContactMessage(f.db, shop, { name: "Ada", email: "ada@example.com", message: "Do you ship lamps to Iceland?", ...input });
    await expect(send({ message: "Hi" })).rejects.toThrow("Write a little more");
    await expect(send({ email: "nope" })).rejects.toThrow("valid email");
    await expect(send({ name: " " })).rejects.toThrow("your name");
    // Bots fill in the hidden field: thanked the same, nothing stored.
    expect(await send({ website: "http://spam.example" })).toBeNull();

    const sent = await send({ email: " Ada@Example.com " });
    expect(sent).toMatchObject({ orderId: null });
    const { conversation, messages } = await getConversation(f.db, shop.id, sent!.conversationId);
    expect(conversation).toMatchObject({ kind: "buyer", email: "ada@example.com", subject: "Message from Ada", status: "needs_merchant" });
    expect(messages.map((m) => m.body)).toEqual(["Do you ship lamps to Iceland?"]);
    expect(await countNeedsYou(f.db, shop.id)).toBe(1);
    expect((await listInbox(f.db, shop.id)).map((c) => c.subject)).toContain("Message from Ada");

    // The merchant answers from the inbox; it's emailed with a way to write back.
    const ctx = { ...f.ctx, storeAddress: () => "https://glow.example" };
    expect(await merchantReply(ctx, shop.id, sent!.conversationId, "Yes, about 10 days to Reykjavik.")).toEqual({ status: "sent" });
    const mail = f.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: "ada@example.com", subject: "Re: your message to Glow Lamps" });
    expect(mail.text).toContain("Yes, about 10 days to Reykjavik.");
    expect(mail.text).toContain("https://glow.example/contact");
    expect((await getConversation(f.db, shop.id, sent!.conversationId)).conversation.status).toBe("resolved");

    // A few an hour per person.
    await send({ message: "One more question about plugs." });
    await send({ message: "And one about the warranty." });
    await expect(send({ message: "And another one about colours." })).rejects.toThrow("several messages");
  });

  it("joins the order's conversation when the number matches the buyer's email", async () => {
    const f = await makeFixture(new DemoModel());
    const order = await f.waitingOrder();
    const shop = await f.shop();
    // Someone else's order number doesn't get them into that order.
    const stranger = await sendContactMessage(f.db, shop, { name: "Eve", email: "eve@example.com", order: `#${order.number}`, message: "Where is this order going?" });
    expect(stranger!.orderId).toBeNull();
    const own = await sendContactMessage(f.db, shop, { name: "Ada", email: order.email.toUpperCase(), order: `#${order.number}`, message: "When will my lamp arrive?" });
    expect(own!.orderId).toBe(order.id);
    const { conversation, messages } = await getConversation(f.db, shop.id, own!.conversationId);
    expect(conversation).toMatchObject({ orderId: order.id, subject: `Order #${order.number}` });
    expect(messages.at(-1)!.body).toBe("When will my lamp arrive?");
    const rows = await f.db.query.conversations.findMany({ where: eq(schema.conversations.orderId, order.id) });
    expect(rows).toHaveLength(1);
  });
});
