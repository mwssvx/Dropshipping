"use server";
import { revalidatePath } from "next/cache";
import { createGiftCardProduct, issueGiftCard, parseMoney, resendGiftCard, setGiftCardDisabled, UserError } from "@sf/core";
import { campaigns, requireShop } from "@/lib/server";
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
  const { shop, user } = await requireShop("gift_cards");
  return attempt(async () => {
    const raw = String(form.get("amount") ?? "").trim();
    const { sent } = await issueGiftCard(await campaigns(), shop, {
      email: String(form.get("email") ?? ""),
      amountMinor: raw ? amount(raw) : 0,
      note: String(form.get("note") ?? ""),
      userId: user.id,
    });
    if (!sent) throw new UserError("The gift card was made but the email didn't go out. Use \"Send a new code\" on it to try again.");
  });
}

export async function resendGiftCardAction(id: string, _: FormState, _form: FormData): Promise<FormState> {
  const { shop } = await requireShop("gift_cards");
  return attempt(async () => resendGiftCard(await campaigns(), shop, id));
}

export async function setGiftCardDisabledAction(id: string, disabled: boolean, _: FormState, _form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("gift_cards");
  return attempt(() => setGiftCardDisabled(db, shop.id, id, disabled));
}
