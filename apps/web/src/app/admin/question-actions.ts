"use server";
import { revalidatePath } from "next/cache";
import { answerQuestion, deleteQuestion, draftAnswerWithAi, setQuestionPublished, UserError } from "@sf/core";
import { agents, requireShop, stock } from "@/lib/server";

/** On an error the form shows what was typed again. */
export type AnswerState = { error?: string; message?: string; answer?: string };

function refresh(handle: string) {
  revalidatePath("/admin", "layout");
  revalidatePath(`/s/${handle}`, "layout");
}

export async function answerQuestionAction(id: string, _: AnswerState, form: FormData): Promise<AnswerState> {
  const { shop } = await requireShop("reviews");
  const answer = String(form.get("answer") ?? "");
  try {
    const { emailed } = await answerQuestion(await stock(), shop, id, { answer, publish: form.get("publish") === "on" });
    refresh(shop.handle);
    return { message: emailed ? "Answer sent. They'll get it by email." : "Answer saved." };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, answer };
    throw e;
  }
}

export async function draftAnswerAction(id: string, _: AnswerState): Promise<AnswerState> {
  const { shop } = await requireShop("reviews");
  try {
    const run = await draftAnswerWithAi(await agents(), shop, id);
    revalidatePath("/admin", "layout");
    if (run.status === "over_budget") return { error: "This month's AI budget is used up. You can raise it in AI settings." };
    if (!run.draft) return { error: run.error ?? "The AI couldn't draft an answer. Try again, or write one yourself." };
    return { message: "Drafted. Read it over and change anything before you send it.", answer: run.draft };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function publishQuestionAction(id: string, publish: boolean) {
  const { shop, db } = await requireShop("reviews");
  await setQuestionPublished(db, shop.id, id, publish).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  refresh(shop.handle);
}

export async function deleteQuestionAction(id: string) {
  const { shop, db } = await requireShop("reviews");
  await deleteQuestion(db, shop.id, id).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  refresh(shop.handle);
}
