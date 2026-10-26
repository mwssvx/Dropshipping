"use server";
import { revalidatePath } from "next/cache";
import { addStarterReplies, deleteSavedReply, saveSavedReply, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type SavedReplyState = { error?: string; saved?: string };

/** Adds a saved reply, or changes one when the form carries its id. */
export async function savedReplyAction(_: SavedReplyState, form: FormData): Promise<SavedReplyState> {
  const { shop, db } = await requireShop("inbox");
  const id = String(form.get("id") ?? "") || undefined;
  try {
    const reply = await saveSavedReply(db, shop.id, { id, title: String(form.get("title") ?? ""), body: String(form.get("body") ?? "") });
    revalidatePath("/admin/inbox", "layout");
    return { saved: reply.title };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function deleteSavedReplyAction(id: string) {
  const { shop, db } = await requireShop("inbox");
  await deleteSavedReply(db, shop.id, id);
  revalidatePath("/admin/inbox", "layout");
}

export async function addStarterRepliesAction() {
  const { shop, db } = await requireShop("inbox");
  await addStarterReplies(db, shop.id);
  revalidatePath("/admin/inbox", "layout");
}
