"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eraseCustomer, parseMoney, sendPersonalCode, setTaxExemption, updateCustomerNotes, UserError } from "@sf/core";
import { campaigns, logged, requireShop } from "@/lib/server";

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

export type CodeState = { error?: string; sent?: string };

/** Sends one customer a one-time code with a message, from their page. */
export async function sendPersonalCodeAction(id: string, _: CodeState, form: FormData): Promise<CodeState> {
  const { shop, db, user } = await requireShop("marketing");
  const kind = form.get("kind") === "amount" ? "amount" : "percent";
  const raw = String(form.get("value") ?? "").trim();
  let value: number;
  try {
    value = kind === "amount" ? parseMoney(raw) : Number.parseInt(raw, 10);
  } catch {
    return { error: "Enter the amount, like 10.00." };
  }
  try {
    const code = await sendPersonalCode(await campaigns(), shop, id, {
      kind,
      value: Number.isNaN(value) ? 0 : value,
      days: Number.parseInt(String(form.get("days") ?? ""), 10) || 0,
      note: String(form.get("note") ?? ""),
    });
    await logged({ shop, user, db }, `Sent the code ${code.code} to ${code.email}`, { href: `/admin/customers/${id}` });
    revalidatePath(`/admin/customers/${id}`);
    return { sent: code.code };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export type ExemptionState = { error?: string; saved?: "set" | "removed"; number?: string };

/** Records or removes a customer's tax exemption. Tax settings, so not for staff. */
export async function taxExemptionAction(id: string, _: ExemptionState, form: FormData): Promise<ExemptionState> {
  const { shop, db, user } = await requireShop("taxes");
  const number = form.get("intent") === "remove" ? "" : String(form.get("exemption") ?? "");
  if (form.get("intent") !== "remove" && !number.trim()) return { error: "Enter their exemption certificate or resale number." };
  try {
    const saved = await setTaxExemption(db, shop.id, id, number);
    await logged({ shop, user, db }, saved.taxExemptId ? `Made ${saved.email} tax exempt (${saved.taxExemptId})` : `Removed the tax exemption for ${saved.email}`, { href: `/admin/customers/${id}` });
    revalidatePath(`/admin/customers/${id}`);
    return { saved: saved.taxExemptId ? "set" : "removed", number: saved.taxExemptId ?? "" };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, number };
    throw e;
  }
}
