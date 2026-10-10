"use server";
import { revalidatePath } from "next/cache";
import { setInvoiceSettings, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type InvoiceSettingsState = {
  error?: string;
  saved?: boolean;
  values?: { legalName: string; address: string; prefix: string; nextNumber: string; footer: string };
};

export async function invoiceSettingsAction(_: InvoiceSettingsState, form: FormData): Promise<InvoiceSettingsState> {
  const { shop, db } = await requireShop("taxes");
  const values = {
    legalName: String(form.get("legalName") ?? ""),
    address: String(form.get("address") ?? ""),
    prefix: String(form.get("prefix") ?? ""),
    nextNumber: String(form.get("nextNumber") ?? ""),
    footer: String(form.get("footer") ?? ""),
  };
  try {
    await setInvoiceSettings(db, shop.id, { ...values, nextNumber: Number(values.nextNumber.trim()) });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, values };
    throw e;
  }
  revalidatePath("/admin/invoices");
  return { saved: true, values };
}
