"use server";
import { revalidatePath } from "next/cache";
import { checkBulkGiftCards, createGiftCardProduct, formatMoney, issueBulkGiftCards, issueGiftCard, parseMoney, resendGiftCard, setGiftCardDisabled, UserError } from "@sf/core";
import { campaigns, logged, requireShop } from "@/lib/server";
import type { FormState } from "./actions";

function amount(raw: string) {
  try {
    return parseMoney(raw.replace(/^[^\d]+/, ""));
  } catch {
    throw new UserError("Enter amounts like 25 or 49.99.");
  }
}

async function attempt(fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/gift-cards");
  return { saved: true };
}

/** "25, 50, 100" becomes one option per amount. */
export async function sellGiftCardsAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("gift_cards");
  return attempt(async () => {
    const amounts = String(form.get("amounts") ?? "")
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(amount);
    await createGiftCardProduct(db, shop, amounts);
  });
}

export async function issueGiftCardAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, user, db } = await requireShop("gift_cards");
  return attempt(async () => {
    const raw = String(form.get("amount") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const amountMinor = raw ? amount(raw) : 0;
    const { sent } = await issueGiftCard(await campaigns(), shop, { email, amountMinor, note: String(form.get("note") ?? ""), userId: user.id });
    await logged({ shop, user, db }, `Gave a ${formatMoney(amountMinor, shop.currency)} gift card to ${email}`, { href: "/admin/gift-cards" });
    if (!sent) throw new UserError("The gift card was made but the email didn't go out. Use \"Send a new code\" on it to try again.");
  });
}

export async function resendGiftCardAction(id: string, _: FormState, _form: FormData): Promise<FormState> {
  const { shop } = await requireShop("gift_cards");
  return attempt(async () => resendGiftCard(await campaigns(), shop, id));
}

export async function setGiftCardDisabledAction(id: string, disabled: boolean, _: FormState, _form: FormData): Promise<FormState> {
  const { shop, db, user } = await requireShop("gift_cards");
  return attempt(async () => {
    await setGiftCardDisabled(db, shop.id, id, disabled);
    const card = await db.query.giftCards.findFirst({ where: (g, { and, eq }) => and(eq(g.id, id), eq(g.shopId, shop.id)), columns: { last4: true } });
    await logged({ shop, user, db }, `${disabled ? "Turned off" : "Turned back on"} the gift card ending ${card?.last4 ?? "…"}`, { href: "/admin/gift-cards" });
  });
}

export type BulkGiftCardState = { error?: string; preview?: { count: number; total: string; sendOn: string | null }; done?: { issued: number; sent: number; total: string; sendOn: string | null } };

const sendDay = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : null);

/** Checks pasted rows (step "check"), then gives everyone their gift card (step "send"). */
export async function bulkGiftCardsAction(_: BulkGiftCardState, form: FormData): Promise<BulkGiftCardState> {
  const { shop, user, db } = await requireShop("gift_cards");
  const input = { rows: String(form.get("rows") ?? ""), from: String(form.get("from") ?? ""), message: String(form.get("message") ?? ""), sendOn: String(form.get("sendOn") ?? "") };
  try {
    if (form.get("step") !== "send") {
      const checked = checkBulkGiftCards(input);
      return { preview: { count: checked.rows.length, total: formatMoney(checked.totalMinor, shop.currency), sendOn: sendDay(checked.scheduledFor) } };
    }
    const done = await issueBulkGiftCards(await campaigns(), shop, { ...input, userId: user.id });
    const total = formatMoney(done.totalMinor, shop.currency);
    await logged({ shop, user, db }, `Gave ${done.issued} gift cards (${total} in all)${done.scheduledFor ? `, sending on ${sendDay(done.scheduledFor)}` : ""}`, { href: "/admin/gift-cards" });
    revalidatePath("/admin/gift-cards");
    return { done: { issued: done.issued, sent: done.sent, total, sendOn: sendDay(done.scheduledFor) } };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
