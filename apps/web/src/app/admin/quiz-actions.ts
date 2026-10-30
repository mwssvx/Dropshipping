"use server";
import { revalidatePath } from "next/cache";
import { QUIZ_MAX_ANSWERS, QUIZ_MAX_QUESTIONS, setProductQuiz, UserError } from "@sf/core";
import { logged, requireShop } from "@/lib/server";
import type { FormState } from "./actions";

/** Saves the quiz from its numbered fields, or removes it (step "remove"). */
export async function productQuizAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, user, db } = await requireShop("marketing");
  const remove = form.get("step") === "remove";
  const field = (name: string) => String(form.get(name) ?? "");
  try {
    await setProductQuiz(
      db,
      shop.id,
      remove
        ? null
        : {
            title: field("title"),
            intro: field("intro"),
            on: form.get("on") === "on",
            questions: Array.from({ length: QUIZ_MAX_QUESTIONS }, (_, i) => ({
              text: field(`q${i}`),
              answers: Array.from({ length: QUIZ_MAX_ANSWERS }, (_, j) => ({ label: field(`q${i}a${j}`), tag: field(`q${i}t${j}`) })),
            })),
          },
    );
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await logged({ shop, user, db }, remove ? "Removed the product quiz" : "Saved the product quiz", { href: "/admin/quiz" });
  revalidatePath("/admin/quiz");
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { saved: true };
}
