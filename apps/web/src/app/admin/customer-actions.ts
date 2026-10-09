"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eraseCustomer, updateCustomerNotes, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type NotesState = { error?: string; saved?: boolean; note?: string; tags?: string };

export async function customerNotesAction(id: string, _: NotesState, form: FormData): Promise<NotesState> {
  const { shop, db } = await requireShop("customers");
  const note = String(form.get("note") ?? "");
  const tags = String(form.get("tags") ?? "");
  try {
    const saved = await updateCustomerNotes(db, shop.id, id, { note, tags });
    revalidatePath("/admin/customers", "layout");
    return { saved: true, note: saved.note ?? "", tags: saved.tags.join(", ") };
  } catch (e) {
    // Typed values come back so a mistake doesn't wipe the note.
    if (e instanceof UserError) return { error: e.message, note, tags };
    throw e;
  }
}

export async function eraseCustomerAction(id: string, _: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const { shop, db } = await requireShop("privacy");
  let orders = 0;
  try {
    ({ orders } = await eraseCustomer(db, shop.id, id, { confirmEmail: String(form.get("confirm") ?? "") }));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/customers", "layout");
  revalidatePath("/admin/orders", "layout");
  redirect(`/admin/customers?erased=${orders}`);
}
