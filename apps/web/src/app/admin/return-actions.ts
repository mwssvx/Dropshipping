"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decideReturn, parseMoney, sendReplacement, setReturnSettings, UserError, type ReturnDecision } from "@sf/core";
import { fulfillment, notifyLater, refunds, requireShop, storeAddress } from "@/lib/server";
import type { FormState } from "./actions";

async function attempt(fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/returns");
  revalidatePath("/admin/orders", "layout");
  return { saved: true };
}

export async function returnSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("returns");
  return attempt(() =>
    setReturnSettings(db, shop.id, {
      windowDays: Number(String(form.get("windowDays") ?? "").trim() || NaN),
      instructions: String(form.get("instructions") ?? ""),
    }),
  );
}

/** One form, four buttons: the pressed button's value says what the merchant decided. */
export async function decideReturnAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop } = await requireShop("returns");
  return attempt(async () => {
    const action = String(form.get("decision") ?? "");
    const message = String(form.get("message") ?? "");
    const amount = () => {
      try {
        return parseMoney(String(form.get("amount") ?? "").trim().replace(/^[^\d]+/, ""));
      } catch {
        throw new UserError("Enter an amount like 12.50.");
      }
    };
    let decision: ReturnDecision;
    if (action === "approve") decision = { action, message };
    else if (action === "decline") decision = { action, message };
    else if (action === "refund" || action === "credit") decision = { action, amountMinor: amount(), message };
    else if (action === "replace") decision = { action, message };
    else throw new UserError("Pick what to do with this return.");
    await decideReturn({ ...(await refunds()), storeAddress }, shop, id, decision);
    if (action === "refund") notifyLater(shop.id);
  });
}

/** From an order's page: send some or all of its items again, free, as a new order. */
export async function sendReplacementAction(orderId: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop } = await requireShop("orders");
  const items = [...form.keys()]
    .filter((k) => k.startsWith("qty-"))
    .map((k) => ({ lineId: k.slice(4), quantity: Number(String(form.get(k) ?? "0").trim() || 0) }));
  let number: number;
  let id: string;
  try {
    if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 0)) throw new UserError("Enter whole numbers for the quantities.");
    ({ id, number } = await sendReplacement(await fulfillment(), shop, orderId, { items, note: String(form.get("note") ?? "") }));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/orders", "layout");
  redirect(`/admin/orders/${id}?replacement=${number}`);
}
