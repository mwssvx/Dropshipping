"use server";
import { revalidatePath } from "next/cache";
import { openTicket, replyToTicket, UserError } from "@sf/core";
import { logged, requireShop } from "@/lib/server";

export type SupportState = { error?: string; message?: string; sent?: number };

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** A merchant writes to our team: a person answers within the plan's promised time. */
export async function openTicketAction(_: SupportState, form: FormData): Promise<SupportState> {
  const { shop, user, db } = await requireShop();
  try {
    const t = await openTicket(db, shop.id, { subject: field(form, "subject"), body: field(form, "body") });
    await logged({ shop, user, db }, `Wrote to our support team: ${t.subject}`, { href: "/admin/support" });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/support");
  return { message: "Sent. A person from our team answers here and in your assistant chat.", sent: Date.now() };
}

export async function replyToTicketAction(conversationId: string, _: SupportState, form: FormData): Promise<SupportState> {
  const { shop, db } = await requireShop();
  try {
    await replyToTicket(db, shop.id, conversationId, field(form, "body"));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/support");
  return { message: "Added.", sent: Date.now() };
}
