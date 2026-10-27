import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { answerSurvey, DemoModel, exportStore, importStore, setSurvey, surveyFor, surveyReport } from "../src";
import { makeFixture } from "../evals/fixture";

describe("buyer survey", () => {
  it("keeps the question and answers tidy", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await expect(setSurvey(f.db, shop.id, { question: "  ", options: ["A", "B"] })).rejects.toThrow("Write the question");
    await expect(setSurvey(f.db, shop.id, { question: "How did you find us?", options: ["Instagram", " instagram ", "Other"] })).rejects.toThrow("at least 2");
    await expect(setSurvey(f.db, shop.id, { question: "How did you find us?", options: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] })).rejects.toThrow("8 answers or fewer");
    const survey = await setSurvey(f.db, shop.id, { question: " How did you  hear about us? ", options: ["Instagram", "", "instagram", "A friend", "Other"], other: true });
    expect(survey).toEqual({ question: "How did you hear about us?", options: ["Instagram", "A friend"], other: true });
    expect((await f.shop()).survey).toEqual(survey);
    expect(await setSurvey(f.db, shop.id, null)).toBeNull();
  });

  it("asks once after paying, and adds up orders and money per answer", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const first = await f.order(f.products.lamp.id);
    // Off: nothing to ask.
    expect(surveyFor(shop, first)).toBeNull();
    await setSurvey(f.db, shop.id, { question: "How did you hear about us?", options: ["Instagram", "A friend"], other: true });
    const s = await f.shop();
    expect(surveyFor(s, first)?.question).toBe("How did you hear about us?");
    expect(surveyFor(s, first, new Date(first.createdAt.getTime() + 31 * 86_400_000))).toBeNull();

    await expect(answerSurvey(f.db, s, first.paymentIntentId!, { answer: "TikTok" })).rejects.toThrow("Pick one of the answers.");
    expect(await answerSurvey(f.db, s, first.paymentIntentId!, { answer: "Instagram" })).toEqual({ answer: "Instagram", other: null });
    await expect(answerSurvey(f.db, s, first.paymentIntentId!, { answer: "A friend" })).rejects.toThrow("already answered");
    const answered = await f.db.query.orders.findFirst({ where: eq(schema.orders.id, first.id) });
    expect(surveyFor(s, answered!)).toBeNull();

    const second = await f.order(f.products.lamp.id);
    await answerSurvey(f.db, s, second.paymentIntentId!, { answer: "Instagram" });
    const third = await f.order(f.products.lamp.id);
    await answerSurvey(f.db, s, third.paymentIntentId!, { answer: "Other", other: "  A podcast   about lamps " });
    await f.order(f.products.lamp.id);

    const report = await surveyReport(f.db, shop.id, 30);
    expect(report.orders).toBe(4);
    expect(report.answered).toBe(3);
    expect(report.rows.map((r) => [r.answer, r.orders])).toEqual([["Instagram", 2], ["Other", 1]]);
    expect(report.rows[0]!.revenueMinor).toBe(first.totalMinor + second.totalMinor);
    expect(report.rows[0]!.share).toBeCloseTo(2 / 3);
    expect(report.others).toEqual([{ text: "A podcast about lamps", number: third.number }]);

    // Without the "Other" box, typing your own isn't allowed.
    await setSurvey(f.db, shop.id, { question: "How did you hear about us?", options: ["Instagram", "A friend"] });
    const fourth = await f.order(f.products.lamp.id);
    await expect(answerSurvey(f.db, await f.shop(), fourth.paymentIntentId!, { answer: "Other", other: "Radio" })).rejects.toThrow("Pick one");
  });

  it("goes along when the store is copied", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await setSurvey(f.db, shop.id, { question: "How did you hear about us?", options: ["Instagram", "A friend"], other: true });
    const data = await exportStore(f.db, shop.id);
    const g = await makeFixture(new DemoModel());
    const target = await g.shop();
    await g.db.delete(schema.products).where(eq(schema.products.shopId, target.id));
    await importStore(g.db, target.id, data);
    expect((await g.shop()).survey).toEqual({ question: "How did you hear about us?", options: ["Instagram", "A friend"], other: true });
  });
});
