import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, parseQuizAnswers, quizPicks, setProductQuiz } from "../src";
import { makeFixture } from "../evals/fixture";

describe("product quiz", () => {
  it("points shoppers to the products with the most of their answers' tags", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const { lamp, projector, stand } = f.products;
    const tag = (id: string, tags: string[]) => f.db.update(schema.products).set({ tags }).where(eq(schema.products.id, id));
    await tag(lamp.id, ["bedroom", "warm"]);
    await tag(projector.id, ["bedroom", "kids"]);
    // A draft is never picked, whatever its tags.
    await tag(stand.id, ["kids", "warm"]);

    const quiz = {
      title: "Find your light",
      intro: "Two questions, and we'll pick for you.",
      on: true,
      questions: [
        { text: "Which room?", answers: [{ label: "Bedroom", tag: "Bedroom " }, { label: "Office", tag: "warm" }] },
        { text: "Who's it for?", answers: [{ label: "Kids", tag: "kids" }, { label: "Me", tag: "warm" }, { label: "", tag: "" }] },
        { text: "", answers: [{ label: "", tag: "" }] },
      ],
    };
    await expect(setProductQuiz(f.db, shopId, { ...quiz, title: " " })).rejects.toThrow("Give the quiz a title");
    await expect(setProductQuiz(f.db, shopId, { ...quiz, questions: [{ text: "Which room?", answers: [{ label: "Bedroom", tag: "bedroom" }] }] })).rejects.toThrow("at least two answers");
    await expect(setProductQuiz(f.db, shopId, { ...quiz, questions: [{ text: "Which room?", answers: [{ label: "Bedroom", tag: "bedroom" }, { label: "Garden", tag: "garden" }] }] })).rejects.toThrow(
      'No product is tagged "garden" yet',
    );
    const saved = await setProductQuiz(f.db, shopId, quiz);
    // Empty rows are dropped and tags are written the way products use them.
    expect(saved).toEqual({
      title: "Find your light",
      intro: "Two questions, and we'll pick for you.",
      on: true,
      questions: [
        { text: "Which room?", answers: [{ label: "Bedroom", tag: "bedroom" }, { label: "Office", tag: "warm" }] },
        { text: "Who's it for?", answers: [{ label: "Kids", tag: "kids" }, { label: "Me", tag: "warm" }] },
      ],
    });

    const shop = await f.shop();
    expect(parseQuizAnswers(shop.productQuiz!, "0,1")).toEqual([0, 1]);
    expect(parseQuizAnswers(shop.productQuiz!, "7,x")).toEqual([null, null]);
    expect(parseQuizAnswers(shop.productQuiz!, ",0")).toEqual([null, 0]);

    // Bedroom + kids: the projector has both, the lamp one.
    const kids = await quizPicks(f.db, shop, [0, 0]);
    expect(kids.products.map((p) => p.title)).toEqual(["Galaxy Projector", "Sunset Projection Lamp"]);
    expect(kids.matched.get(projector.id)).toBe(2);
    expect(kids.answered).toBe(2);
    // Bedroom + me: now the lamp matches both.
    expect((await quizPicks(f.db, shop, [0, 1])).products[0]!.title).toBe("Sunset Projection Lamp");
    // One answer skipped.
    expect((await quizPicks(f.db, shop, [null, 0])).products.map((p) => p.title)).toEqual(["Galaxy Projector"]);
    expect(await quizPicks(f.db, shop, [null, null])).toMatchObject({ products: [], answered: 0 });

    // Sold out isn't a pick.
    await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.productId, projector.id));
    expect((await quizPicks(f.db, shop, [0, 0])).products.map((p) => p.title)).toEqual(["Sunset Projection Lamp"]);

    await setProductQuiz(f.db, shopId, null);
    expect((await f.shop()).productQuiz).toBeNull();
  });
});
