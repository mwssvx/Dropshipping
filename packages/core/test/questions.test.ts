import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  answerQuestion, askQuestion, deleteQuestion, DemoModel, draftAnswerWithAi, eraseCustomer, exportCustomerData, listQuestions, MAX_QUESTIONS_PER_DAY, productQuestions,
  setQuestionPublished, waitingQuestions,
} from "../src";
import { makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  return { ...f, shopRow: await f.shop(), qctx: { ...f.ctx, storeAddress: () => "https://glow.example" } };
}

describe("product questions", () => {
  it("takes questions on products on sale and keeps spam out", async () => {
    const f = await setup();
    const { lamp, stand } = f.products;
    const ask = (input: Partial<Parameters<typeof askQuestion>[2]>) =>
      askQuestion(f.db, f.shopRow.id, { productId: lamp.id, name: "Ada", email: "ada@example.com", body: "Does it come with a UK plug?", ...input });
    await expect(ask({ body: "Plug?" })).rejects.toThrow("at least 10 characters");
    await expect(ask({ email: "not an email" })).rejects.toThrow("Enter your email");
    // The stand is still a draft.
    await expect(ask({ productId: stand.id })).rejects.toThrow("isn't available");
    const q = await ask({ email: " Ada@Example.com " });
    expect(q).toMatchObject({ status: "waiting", email: "ada@example.com", answer: null });
    for (let i = 1; i < MAX_QUESTIONS_PER_DAY; i++) await ask({ body: `Question number ${i} about the lamp` });
    await expect(ask({})).rejects.toMatchObject({ code: "too_many" });
    expect(await waitingQuestions(f.db, f.shopRow.id)).toBe(MAX_QUESTIONS_PER_DAY);
    // Nothing shows on the page until it's answered.
    expect(await productQuestions(f.db, lamp.id)).toEqual([]);
  });

  it("drafts an answer with AI, emails the shopper once, and shows it on the page", async () => {
    const f = await setup();
    const { lamp } = f.products;
    const q = await askQuestion(f.db, f.shopRow.id, { productId: lamp.id, name: "Ada Lovelace", email: "ada@example.com", body: "How long does delivery take to Texas?" });
    const odd = await askQuestion(f.db, f.shopRow.id, { productId: lamp.id, name: "Grace", email: "grace@example.com", body: "Is the cable made of recycled plastic?" });

    const run = await draftAnswerWithAi(f.ctx, f.shopRow, q.id);
    expect(run.status).toBe("done");
    expect(run.draft).toMatch(/^Thanks for asking! It usually arrives in \d+ to \d+ days/);
    // What the listing doesn't say is marked for the merchant to check.
    expect((await draftAnswerWithAi(f.ctx, f.shopRow, odd.id)).draft).toMatch(/^\[Check: /);

    const before = f.mailer.sent.length;
    const { emailed } = await answerQuestion(f.qctx, f.shopRow, q.id, { answer: run.draft!, publish: true });
    expect(emailed).toBe(true);
    const [mail] = f.mailer.sent.slice(before);
    expect(mail).toMatchObject({ to: "ada@example.com", subject: `Your question about ${lamp.title}` });
    expect(mail!.text).toContain("Hi Ada Lovelace,");
    expect(mail!.text).toContain("“How long does delivery take to Texas?”");
    expect(mail!.text).toContain(`/products/${lamp.handle}#questions`);
    await expect(draftAnswerWithAi(f.ctx, f.shopRow, q.id)).rejects.toThrow("answered already");

    const shown = await productQuestions(f.db, lamp.id);
    expect(shown).toEqual([expect.objectContaining({ name: "Ada Lovelace", body: q.body, answer: run.draft })]);
    expect(Object.keys(shown[0]!)).not.toContain("email");

    // Changing the answer or hiding it doesn't email again.
    await answerQuestion(f.qctx, f.shopRow, q.id, { answer: "About a week to Texas.", publish: true });
    await setQuestionPublished(f.db, f.shopRow.id, q.id, false);
    expect(f.mailer.sent.length).toBe(before + 1);
    expect(await productQuestions(f.db, lamp.id)).toEqual([]);
    await expect(setQuestionPublished(f.db, f.shopRow.id, odd.id, true)).rejects.toThrow("Answer the question first");

    // Waiting first, then answered.
    expect((await listQuestions(f.db, f.shopRow.id)).map((x) => [x.id, x.status])).toEqual([
      [odd.id, "waiting"],
      [q.id, "private"],
    ]);
    await deleteQuestion(f.db, f.shopRow.id, odd.id);
    await expect(deleteQuestion(f.db, f.shopRow.id, odd.id)).rejects.toThrow("not found");
  });

  it("travels in a buyer's data export and goes when they're erased", async () => {
    const f = await setup();
    const order = await f.shippedOrder();
    const customer = (await f.db.query.customers.findFirst({ where: eq(schema.customers.email, order.email) }))!;
    const answered = await askQuestion(f.db, f.shopRow.id, { productId: f.products.lamp.id, name: "Ada", email: order.email, body: "Can I use it on a timer?" });
    await answerQuestion(f.qctx, f.shopRow, answered.id, { answer: "Yes, it has a 2-hour timer.", publish: true });
    const open = await askQuestion(f.db, f.shopRow.id, { productId: f.products.projector.id, name: "Ada", email: order.email, body: "Does it work on batteries?" });

    const data = await exportCustomerData(f.db, f.shopRow, customer.id);
    expect(data.questions).toEqual([
      expect.objectContaining({ question: "Can I use it on a timer?", answer: "Yes, it has a 2-hour timer.", shown_on_store: true }),
      expect.objectContaining({ question: "Does it work on batteries?", answer: null }),
    ]);

    await eraseCustomer(f.db, f.shopRow.id, customer.id, { confirmEmail: order.email });
    expect(await f.db.query.productQuestions.findFirst({ where: eq(schema.productQuestions.id, open.id) })).toBeUndefined();
    expect(await productQuestions(f.db, f.products.lamp.id)).toEqual([expect.objectContaining({ name: "A shopper", answer: "Yes, it has a 2-hour timer." })]);
    expect(JSON.stringify(await f.db.query.productQuestions.findMany())).not.toContain(order.email);
  });
});
