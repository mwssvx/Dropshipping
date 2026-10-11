"use server";
import { revalidatePath } from "next/cache";
import { setPersonalization, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type PersonalizationState = { error?: string; saved?: number };

/** Saves a product's personalisation fields, sent as JSON from the editor. */
export async function personalizationAction(productId: string, _: PersonalizationState, form: FormData): Promise<PersonalizationState> {
  const { shop, db } = await requireShop("products");
  let fields: unknown;
  try {
    fields = JSON.parse(String(form.get("fields") ?? "[]"));
  } catch {
    return { error: "Something went wrong reading the fields. Try again." };
  }
  if (!Array.isArray(fields)) return { error: "Something went wrong reading the fields. Try again." };
  try {
    const saved = await setPersonalization(
      db,
      shop.id,
      productId,
      fields.map((f: Record<string, unknown>) => ({
        id: typeof f.id === "string" ? f.id : undefined,
        label: String(f.label ?? ""),
        required: f.required === true,
        maxLength: Number(f.maxLength),
      })),
    );
    revalidatePath(`/admin/products/${productId}`);
    return { saved: saved.length };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
