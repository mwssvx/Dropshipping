"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPaymentLink, resendPaymentLink, UserError } from "@sf/core";
import { refunds, requireShop, tax } from "@/lib/server";
import type { FormState } from "./actions";

/** On an error the form shows what was typed again. */
export type LinkState = FormState & { values?: Record<string, string>; lines?: { variantId: string; quantity: number }[] };

export async function createPaymentLinkAction(_: LinkState, form: FormData): Promise<LinkState> {
  const { shop } = await requireShop("orders");
  const v = (k: string) => String(form.get(k) ?? "").trim();
  const quantities = form.getAll("quantity").map((q) => Math.min(99, Math.max(0, Math.floor(Number(q) || 0))));
  const lines = form.getAll("variantId").map((id, i) => ({ variantId: String(id), quantity: quantities[i] ?? 0 })).filter((l) => l.variantId);
  let orderId: string;
  try {
    const { order, sent } = await createPaymentLink(
      await refunds(),
      shop,
      {
        email: v("email"),
        address: { name: v("name"), line1: v("line1"), line2: v("line2") || undefined, city: v("city"), region: v("region") || undefined, postalCode: v("postalCode"), country: v("country"), phone: v("phone") || undefined },
        lines,
        discountCode: v("discountCode") || null,
        note: v("note"),
      },
      tax(),
    );
    orderId = order.id;
    if (!sent) {
      revalidatePath("/admin/orders");
      redirect(`/admin/orders/${order.id}?link=unsent`);
    }
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, values: Object.fromEntries([...form.entries()].filter(([, x]) => typeof x === "string") as [string, string][]), lines };
    throw e;
  }
  revalidatePath("/admin/orders");
  redirect(`/admin/orders/${orderId}?link=sent`);
}

export async function resendPaymentLinkAction(orderId: string, _: FormState): Promise<FormState> {
  const { shop } = await requireShop("orders");
  try {
    await resendPaymentLink(await refunds(), shop.id, orderId);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/admin/orders/${orderId}`);
  return { saved: true };
}
