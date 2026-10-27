import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, setReviewSummary, summarizeReviewsWithAi, UserError } from "../src";
import { makeFixture } from "../evals/fixture";

async function withReviews(ratings: number[]) {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const productId = f.products.lamp.id;
  if (ratings.length)
    await f.db.insert(schema.reviews).values(ratings.map((rating, i) => ({ shopId: shop.id, productId, name: `Buyer ${i}`, rating, body: rating > 3 ? "Lovely warm light, easy to set up." : "Stopped working after a week.", status: "published" as const })));
  const product = async () => (await f.db.query.products.findFirst({ where: eq(schema.products.id, productId) }))!;
  return { f, shop, productId, product };
}

describe("review summaries", () => {
  it("summarizes the published reviews and remembers how many it read", async () => {
    const { f, shop, productId, product } = await withReviews([5, 5, 4, 1]);
    const run = await summarizeReviewsWithAi(f.ctx, shop, productId);
    expect(run.status).toBe("done");
    const p = await product();
    expect(p.reviewSummary).toMatch(/4\.? ?.*out of 5|4 reviews/);
    expect(p.reviewSummaryCount).toBe(4);
    const r = await f.db.query.agentRuns.findFirst({ where: eq(schema.agentRuns.id, run.runId) });
    expect(r).toMatchObject({ agent: "summarizer", model: "claude-haiku-5-5", productId });
  });

  it("needs a few published reviews first", async () => {
    const { f, shop, productId } = await withReviews([5, 4]);
    await expect(summarizeReviewsWithAi(f.ctx, shop, productId)).rejects.toThrow(/at least 3/);
    expect(await f.db.query.agentRuns.findMany()).toHaveLength(0);
  });

  it("lets the merchant edit or remove it, but not add links", async () => {
    const { f, shop, productId, product } = await withReviews([]);
    await setReviewSummary(f.db, shop.id, productId, "Buyers love the colours.", 12);
    expect(await product()).toMatchObject({ reviewSummary: "Buyers love the colours.", reviewSummaryCount: 12 });
    await expect(setReviewSummary(f.db, shop.id, productId, "Great, see https://evil.example")).rejects.toThrow(UserError);
    await setReviewSummary(f.db, shop.id, productId, "  ");
    expect(await product()).toMatchObject({ reviewSummary: null, reviewSummaryCount: null });
  });
});
