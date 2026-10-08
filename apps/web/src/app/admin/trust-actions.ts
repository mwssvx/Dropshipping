"use server";
import { revalidatePath } from "next/cache";
import { refreshVerified, submitAppeal, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";
import type { FormState } from "./actions";

export async function appealAction(noticeId: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop();
  try {
    await submitAppeal(db, shop.id, noticeId, String(form.get("message") ?? ""));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export async function checkVerifiedAction() {
  const { shop, db } = await requireShop();
  await refreshVerified(db, shop.id);
  revalidatePath("/admin/trust");
}
