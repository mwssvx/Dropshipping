import { describe, expect, it } from "vitest";
import { aiImpact, aiMonth, askAssistant, askShopAssistant, DemoModel, handleBuyerMessage, impactLines, sendAiImpactEmails, timeSaved, writeListing } from "../src";
import { makeFixture } from "../evals/fixture";

describe("what the AI did for you", () => {
  it("tallies the month's replies, answers and changes, with a rough time saved and the cost", async () => {
    const f = await makeFixture(new DemoModel());
    await f.setShop({ aiAutoReplyTopics: ["order_status"], aiShopper: true, status: "active" });
    // One question answered on its own, one drafted for the owner.
    const first = await f.shippedOrder();
    await (await handleBuyerMessage(f.ctx, { shopId: first.shopId, paymentIntentId: first.paymentIntentId!, body: "Hi, where is my order?" })).run();
    await f.setShop({ aiAutoReplyTopics: [] });
    const second = await f.shippedOrder();
    await (await handleBuyerMessage(f.ctx, { shopId: second.shopId, paymentIntentId: second.paymentIntentId!, body: "Where is my order?" })).run();
    // A listing rewritten, and a shopper's question on the store.
    await writeListing(f.ctx, await f.shop(), f.products.stand.id);
    await askShopAssistant(f.ctx, await f.shop(), { question: "Do you have a projection lamp?" });

    const shop = await f.shop();
    const r = await aiImpact(f.db, shop.id, aiMonth());
    expect(r).toMatchObject({ repliesOnItsOwn: 1, repliesDrafted: 1, shopperAnswers: 1, shopperChats: 1, changes: 1, reports: 0, waiting: 1 });
    expect(r.byHelper).toEqual({ listing: 1 });
    expect(r.minutesSaved).toBe(5 + 3 + 2 + 4);
    expect(r.costMicros).toBeGreaterThan(0);
    expect(impactLines(r)).toEqual([
      "Answered 1 buyer question on its own",
      "Drafted 1 reply to buyers for you to check",
      "Answered 1 shopper question in 1 chat on your store",
      "Made 1 change to your store (listings, translations, settings and more)",
    ]);
    expect(timeSaved(14)).toBe("About 14 minutes");
    expect(timeSaved(100)).toBe("About 1.5 hours");
    // Last month had nothing.
    expect(impactLines(await aiImpact(f.db, shop.id, aiMonth(new Date(), 1)))).toEqual([]);

    // The owner can ask the Assistant too.
    const chat = await askAssistant(f.ctx, shop, "What did the AI do for me this month?");
    expect(chat.text).toContain("Answered 1 buyer question on its own");
    expect(chat.text).toContain("rough estimate");
  });

  it("emails last month's report once, early in the next month, and not when it's off", async () => {
    const f = await makeFixture(new DemoModel());
    await writeListing(f.ctx, await f.shop(), f.products.stand.id);
    const nextMonth = aiMonth(new Date(), -1).from;
    const ctx = { db: f.db, mailer: f.mailer, adminUrl: (p: string) => `https://admin.example${p}` };
    expect(await sendAiImpactEmails(ctx, nextMonth)).toEqual({ sent: 1 });
    const mail = f.mailer.sent.at(-1)!;
    expect(mail.to).toBe("owner@example.com");
    expect(mail.subject).toBe(`Glow Lamps: what the AI did in ${aiMonth().label}`);
    expect(mail.text).toContain("- Made 1 change to your store");
    expect(mail.text).toContain("Time saved: about 4 minutes");
    expect(mail.text).toContain("https://admin.example/admin/ai");
    expect(await sendAiImpactEmails(ctx, nextMonth)).toEqual({ sent: 0 });

    const g = await makeFixture(new DemoModel());
    await writeListing(g.ctx, await g.shop(), g.products.stand.id);
    await g.setShop({ aiMonthlyEmail: false });
    expect(await sendAiImpactEmails({ ...ctx, db: g.db, mailer: g.mailer }, nextMonth)).toEqual({ sent: 0 });
  });
});
