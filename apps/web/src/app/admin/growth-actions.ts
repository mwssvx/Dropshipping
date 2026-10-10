"use server";
import { revalidatePath } from "next/cache";
import { createDiscount, moderateReview, parseMoney, sendAbandonedCartEmails, setDiscountActive, setGrowthSettings, setUpsell, setWelcomeOffer, UserError } from "@sf/core";
import { fulfillment, requireShop, testPayments } from "@/lib/server";
import type { FormState } from "./actions";

const HOUR = 3_600_000;

function optionalDate(v: FormDataEntryValue | null, endOfDay = false) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(`${s}T${endOfDay ? "23:59:59" : "00:00:00"}Z`);
  if (Number.isNaN(d.getTime())) throw new UserError("Enter dates as YYYY-MM-DD.");
  return d;
}

export async function createDiscountAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("marketing");
  try {
    const kind = String(form.get("kind") ?? "percent") as "percent" | "amount" | "free_shipping";
    const raw = String(form.get("value") ?? "").trim();
    const min = String(form.get("minSubtotal") ?? "").trim();
    const limit = String(form.get("usageLimit") ?? "").trim();
    await createDiscount(db, shop.id, {
      code: String(form.get("code") ?? ""),
      kind,
      value: kind === "percent" ? Number.parseInt(raw || "0", 10) : kind === "amount" ? parseMoney(raw || "0") : 0,
      minSubtotalMinor: min ? parseMoney(min) : 0,
      usageLimit: limit ? Number.parseInt(limit, 10) : null,
      oncePerCustomer: form.get("oncePerCustomer") === "on",
      startsAt: optionalDate(form.get("startsAt")),
      endsAt: optionalDate(form.get("endsAt"), true),
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/marketing");
  return { saved: true };
}

export async function setWelcomeOfferAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("marketing");
  try {
    const int = (name: string) => Number.parseInt(String(form.get(name) ?? "").trim() || "NaN", 10);
    const min = String(form.get("minSubtotal") ?? "").trim();
    await setWelcomeOffer(
      db,
      shop.id,
      form.get("on") === "on" ? { percentOff: int("percentOff"), minSubtotalMinor: min ? parseMoney(min) : 0, days: int("days") } : null,
    );
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/marketing");
  return { saved: true };
}

export async function setDiscountActiveAction(id: string, active: boolean) {
  const { shop, db } = await requireShop("marketing");
  await setDiscountActive(db, shop.id, id, active);
  revalidatePath("/admin/marketing");
}

export async function setRemindersAction(form: FormData) {
  const { shop, db } = await requireShop("marketing");
  await setGrowthSettings(db, shop.id, { abandonedCartEmails: form.get("abandonedCartEmails") === "on" });
  revalidatePath("/admin/marketing");
}

/** Test mode only: send reminders as if an hour had passed, so they can be tried without waiting. */
export async function sendRemindersNowAction() {
  await requireShop("marketing");
  if (!testPayments()) return;
  await sendAbandonedCartEmails(await fulfillment(), new Date(Date.now() + HOUR + 60_000));
  revalidatePath("/admin/marketing");
}

export async function setReviewsAutoPublishAction(form: FormData) {
  const { shop, db } = await requireShop("reviews");
  await setGrowthSettings(db, shop.id, { reviewsAutoPublish: form.get("reviewsAutoPublish") === "on" });
  revalidatePath("/admin/reviews");
}

export async function moderateReviewAction(id: string, status: "published" | "hidden") {
  const { shop, db } = await requireShop("reviews");
  await moderateReview(db, shop.id, id, { status });
  revalidatePath("/admin/reviews");
  revalidatePath("/admin", "layout");
}

export async function replyToReviewAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("reviews");
  await moderateReview(db, shop.id, id, { reply: String(form.get("reply") ?? "") });
  revalidatePath("/admin/reviews");
  return { saved: true };
}

export async function setUpsellAction(productId: string, form: FormData) {
  const { shop, db } = await requireShop("products");
  const id = String(form.get("upsellProductId") ?? "");
  await setUpsell(db, shop.id, productId, id || null);
  revalidatePath(`/admin/products/${productId}`);
}
