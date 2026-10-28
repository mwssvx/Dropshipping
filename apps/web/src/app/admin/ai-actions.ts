"use server";
import { revalidatePath } from "next/cache";
import {
  askAssistant,
  decideAction,
  fixProblemOrder,
  merchantReply,
  runMarginWatch,
  setAiSettings,
  UserError,
  writeListing,
} from "@sf/core";
import { agents, fulfillment, requireShop } from "@/lib/server";
import type { FormState } from "./actions";

export type AgentState = FormState & { message?: string };

const fail = (e: unknown): AgentState => {
  if (e instanceof UserError) return { error: e.message };
  throw e;
};

export async function askAssistantAction(_: AgentState, form: FormData): Promise<AgentState> {
  const { shop } = await requireShop("assistant");
  try {
    await askAssistant(await agents(), shop, String(form.get("message") ?? ""));
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}

/** Approve or turn down something an agent proposed. A message edit applies to drafted replies. */
export async function decideAgentAction(actionId: string, approve: boolean, _: AgentState, form: FormData): Promise<AgentState> {
  const { shop, user } = await requireShop("assistant");
  const edited = form.get("message");
  try {
    await decideAction(await agents(), shop.id, actionId, { approve, by: user.email, message: typeof edited === "string" ? edited : undefined });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin", "layout");
  return { saved: true, message: approve ? "Done." : "Turned down." };
}

export async function writeListingAction(productId: string, _: AgentState): Promise<AgentState> {
  const { shop } = await requireShop("products");
  try {
    const run = await writeListing(await agents(), shop, productId);
    revalidatePath(`/admin/products/${productId}`);
    revalidatePath("/admin", "layout");
    if (run.status === "over_budget") return { error: "This month's AI budget is used up. You can raise it in AI settings." };
    if (run.status === "failed") return { error: run.error ?? "The writer couldn't finish. Try again." };
    return { saved: true, message: run.text };
  } catch (e) {
    return fail(e);
  }
}

export async function fixOrderAction(orderId: string, _: AgentState): Promise<AgentState> {
  const { shop } = await requireShop("orders");
  try {
    const run = await fixProblemOrder(await agents(), shop, orderId);
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin", "layout");
    if (run.status === "over_budget") return { error: "This month's AI budget is used up. You can raise it in AI settings." };
    return { saved: true, message: run.text || run.error || "Done." };
  } catch (e) {
    return fail(e);
  }
}

export async function marginCheckAction(_: AgentState): Promise<AgentState> {
  const { shop } = await requireShop("assistant");
  try {
    const run = await runMarginWatch(await agents(), shop, "merchant");
    revalidatePath("/admin", "layout");
    if (!run) return { saved: true, message: "Every product on sale keeps at least 10% after costs and fees. Nothing to change." };
    if (run.status === "over_budget") return { error: "This month's AI budget is used up." };
    return { saved: true, message: run.text };
  } catch (e) {
    return fail(e);
  }
}

export async function saveAiSettingsAction(_: AgentState, form: FormData): Promise<AgentState> {
  const { shop, db } = await requireShop("ai");
  const budget = String(form.get("budget") ?? "").trim();
  try {
    await setAiSettings(db, shop, {
      budgetMinor: budget === "" ? null : Math.round(Number(budget) * 100),
      autoReplyTopics: form.getAll("topics").map(String),
      autoPause: form.get("autoPause") === "on",
      shopper: form.get("shopper") === "on",
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export async function inboxReplyAction(conversationId: string, _: AgentState, form: FormData): Promise<AgentState> {
  const { shop } = await requireShop("inbox");
  try {
    await merchantReply(await fulfillment(), shop.id, conversationId, String(form.get("message") ?? ""));
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}
