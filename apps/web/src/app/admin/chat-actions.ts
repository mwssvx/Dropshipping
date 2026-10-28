"use server";
import { revalidatePath } from "next/cache";
import { setChatButtons, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type ChatButtonsState = { error?: string; saved?: boolean };

export async function setChatButtonsAction(_: ChatButtonsState, form: FormData): Promise<ChatButtonsState> {
  const { shop, db } = await requireShop("inbox");
  try {
    await setChatButtons(db, shop.id, { whatsapp: String(form.get("whatsapp") ?? ""), telegram: String(form.get("telegram") ?? "") });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/inbox");
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { saved: true };
}
