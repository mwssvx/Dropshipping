"use server";
import { revalidatePath } from "next/cache";
import { decideAppeal, sendNotice, staffReply, UserError, type NoticeReason } from "@sf/core";
import { requireStaff } from "@/lib/server";
import type { FormState } from "../admin/actions";

export async function sendNoticeAction(shopId: string, _: FormState, form: FormData): Promise<FormState> {
  const { user, db } = await requireStaff();
  try {
    const due = String(form.get("dueBy") ?? "");
    await sendNotice(db, {
      shopId,
      kind: String(form.get("kind")) as "warning" | "paused" | "reinstated",
      reason: String(form.get("reason")) as NoticeReason,
      explanation: String(form.get("explanation") ?? ""),
      whatToDo: String(form.get("whatToDo") ?? ""),
      dueBy: due ? new Date(`${due}T23:59:59Z`) : null,
      by: user.email,
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/staff", "layout");
  return { saved: true };
}

export async function decideAppealAction(appealId: string, _: FormState, form: FormData): Promise<FormState> {
  const { user, db } = await requireStaff();
  try {
    await decideAppeal(db, appealId, { accept: form.get("decision") === "accept", response: String(form.get("response") ?? ""), by: user.email });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/staff", "layout");
  return { saved: true };
}

export async function staffReplyAction(conversationId: string, _: FormState, form: FormData): Promise<FormState> {
  const { user, db } = await requireStaff();
  try {
    await staffReply(db, conversationId, { body: String(form.get("message") ?? ""), close: form.get("close") === "on", by: user.email });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/staff", "layout");
  return { saved: true };
}
