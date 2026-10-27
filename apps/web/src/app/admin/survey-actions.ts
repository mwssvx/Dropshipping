"use server";
import { revalidatePath } from "next/cache";
import { setSurvey, UserError } from "@sf/core";
import { logged, requireShop } from "@/lib/server";

export type SurveyState = { error?: string; saved?: "on" | "off" };

/** Turns the "How did you hear about us?" question on with its answers, or off. */
export async function surveyAction(_: SurveyState, form: FormData): Promise<SurveyState> {
  const { shop, db, user } = await requireShop("marketing");
  const on = form.get("intent") !== "off";
  try {
    await setSurvey(db, shop.id, on ? {
      question: String(form.get("question") ?? ""),
      options: String(form.get("options") ?? "").split("\n"),
      other: form.get("other") === "on",
    } : null);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await logged({ shop, user, db }, on ? "Saved the buyer survey" : "Turned off the buyer survey", { href: "/admin/survey" });
  revalidatePath("/admin/survey");
  return { saved: on ? "on" : "off" };
}
