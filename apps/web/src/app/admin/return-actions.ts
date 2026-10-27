"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decideReturn, formatMoney, parseMoney, sendReplacement, setReturnSettings, UserError, type ReturnDecision } from "@sf/core";
import { fulfillment, logged, notifyLater, refunds, requireShop, storeAddress } from "@/lib/server";
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

/** One form, several buttons: the pressed button's value says what the merchant decided. */
export async function decideReturnAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, user, db } = await requireShop("returns");
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
    else if (action === "replace" || action === "exchange") decision = { action, message };
    else throw new UserError("Pick what to do with this return.");
    await decideReturn({ ...(await refunds()), storeAddress }, shop, id, decision);
    const request = await db.query.returnRequests.findFirst({ where: (r, { and, eq }) => and(eq(r.id, id), eq(r.shopId, shop.id)), columns: { orderId: true } });
    const money = "amountMinor" in decision ? formatMoney(decision.amountMinor, shop.currency) : "";
    const said = {
      approve: "Approved the return on order {order}",
      decline: "Declined the return on order {order}",
      refund: `Refunded ${money} for the return on order {order}`,
      credit: `Gave ${money} store credit for the return on order {order}`,
      replace: "Sent a replacement for the return on order {order}",
      exchange: "Sent an exchange for the return on order {order}",
    }[decision.action];
    await logged({ shop, user, db }, said, request ? { orderId: request.orderId } : { href: "/admin/returns" });
    if (action === "refund") notifyLater(shop.id);
  });
}

/** From an order's page: send some or all of its items again, free, as a new order. */
export async function sendReplacementAction(orderId: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, user, db } = await requireShop("orders");
  const items = [...form.keys()]
    .filter((k) => k.startsWith("qty-"))
    .map((k) => ({ lineId: k.slice(4), quantity: Number(String(form.get(k) ?? "0").trim() || 0) }));
  let number: number;
  let id: string;
  try {
    if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 0)) throw new UserError("Enter whole numbers for the quantities.");
    ({ id, number } = await sendReplacement(await fulfillment(), shop, orderId, { items, note: String(form.get("note") ?? "") }));
    await logged({ shop, user, db }, `Sent a free replacement (#${number}) for order {order}`, { orderId });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/orders", "layout");
  redirect(`/admin/orders/${id}?replacement=${number}`);
}
