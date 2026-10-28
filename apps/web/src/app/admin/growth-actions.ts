"use server";
import { revalidatePath } from "next/cache";
import { createDiscount, moderateReview, parseMoney, sendAbandonedCartEmails, setAbandonedCartOffer, setDiscountActive, setBirthdayOffer, setGrowthSettings, setPostPurchaseOffer, setReferralProgram, setReviewRequestDays, setSubscriptionOffer, setUpsell, setWelcomeOffer, setWinbackOffer, UserError } from "@sf/core";
import { fulfillment, logged, requireShop, testPayments } from "@/lib/server";
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
  const { shop, db, user } = await requireShop("marketing");
  try {
    const kind = String(form.get("kind") ?? "percent") as "percent" | "amount" | "free_shipping" | "bxgy";
    const count = (name: string) => {
      const n = Number(String(form.get(name) ?? "").trim());
      return Number.isInteger(n) ? n : null;
    };
    const raw = String(form.get("value") ?? "").trim();
    const min = String(form.get("minSubtotal") ?? "").trim();
    const limit = String(form.get("usageLimit") ?? "").trim();
    const created = await createDiscount(db, shop.id, {
      code: String(form.get("code") ?? ""),
      kind,
      value: kind === "percent" || kind === "bxgy" ? Number.parseInt(raw || "0", 10) : kind === "amount" ? parseMoney(raw || "0") : 0,
      ...(kind === "bxgy" ? { buyQty: count("buyQty"), getQty: count("getQty") } : {}),
      productIds: kind === "free_shipping" ? [] : form.getAll("productIds").map(String),
      collectionId: kind === "free_shipping" ? null : String(form.get("collectionId") ?? "") || null,
      automatic: kind !== "free_shipping" && form.get("automatic") === "on",
      minSubtotalMinor: min ? parseMoney(min) : 0,
      usageLimit: limit ? Number.parseInt(limit, 10) : null,
      oncePerCustomer: form.get("oncePerCustomer") === "on",
      customerTag: kind === "bxgy" ? null : String(form.get("customerTag") ?? ""),
      startsAt: optionalDate(form.get("startsAt")),
      endsAt: optionalDate(form.get("endsAt"), true),
    });
    await logged({ shop, user, db }, `Created the discount code ${created.code}`, { href: "/admin/marketing" });
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

export async function setWinbackOfferAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("marketing");
  try {
    const int = (name: string) => Number.parseInt(String(form.get(name) ?? "").trim() || "NaN", 10);
    await setWinbackOffer(db, shop.id, form.get("on") === "on" ? { afterDays: int("afterDays"), percentOff: int("percentOff"), days: int("days") } : null);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/marketing");
  return { saved: true };
}

export async function setPostPurchaseOfferAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("marketing");
  try {
    const productId = String(form.get("productId") ?? "") || null;
    const percent = String(form.get("percentOff") ?? "").trim();
    await setPostPurchaseOffer(db, shop.id, { productId, percentOff: percent ? Number(percent) : 0, active: form.get("on") === "on" });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/marketing");
  return { saved: true };
}

export async function setSubscriptionOfferAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("marketing");
  try {
    const percent = String(form.get("percentOff") ?? "").trim();
    await setSubscriptionOffer(db, shop.id, { percentOff: percent ? Number(percent) : Number.NaN, active: form.get("on") === "on" });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/marketing");
  revalidatePath("/admin/subscriptions");
  return { saved: true };
}

export async function setReferralProgramAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("marketing");
  try {
    const min = String(form.get("minSubtotal") ?? "").trim();
    const reward = String(form.get("reward") ?? "").trim();
    let rewardMinor = Number.NaN;
    try {
      rewardMinor = parseMoney(reward);
    } catch {
      if (form.get("on") === "on") throw new UserError("Enter the credit like 10.00.");
    }
    await setReferralProgram(
      db,
      shop.id,
      form.get("on") === "on"
        ? { friendPercentOff: Number.parseInt(String(form.get("percentOff") ?? "").trim() || "NaN", 10), rewardMinor, minSubtotalMinor: min ? parseMoney(min) : 0 }
        : null,
    );
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/marketing");
  return { saved: true };
}

export async function setDiscountActiveAction(id: string, active: boolean) {
  const { shop, db, user } = await requireShop("marketing");
  await setDiscountActive(db, shop.id, id, active);
  const d = await db.query.discounts.findFirst({ where: (t, { and, eq }) => and(eq(t.id, id), eq(t.shopId, shop.id)), columns: { code: true } });
  if (d) await logged({ shop, user, db }, `${active ? "Turned on" : "Turned off"} the discount code ${d.code}`, { href: "/admin/marketing" });
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

export type ReminderOfferState = { error?: string; saved?: number | null };

/** The second checkout reminder: off, or on with a percentage off in a one-time code. */
export async function setReminderOfferAction(_: ReminderOfferState, form: FormData): Promise<ReminderOfferState> {
  const { shop, db, user } = await requireShop("marketing");
  const on = form.get("enabled") === "on";
  const percent = on ? Number.parseInt(String(form.get("percentOff") ?? "").trim() || "0", 10) : null;
  try {
    await setAbandonedCartOffer(db, shop.id, percent);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await logged({ shop, user, db }, percent ? `Turned on the second checkout reminder with ${percent}% off` : "Turned off the second checkout reminder", { href: "/admin/marketing#reminders-heading" });
  revalidatePath("/admin/marketing");
  return { saved: percent };
}

/** Test mode only: send second reminders as if a day had passed since the first ones. */
export async function sendOffersNowAction() {
  await requireShop("marketing");
  if (!testPayments()) return;
  await sendAbandonedCartEmails(await fulfillment(), new Date(Date.now() + 25 * HOUR));
  revalidatePath("/admin/marketing");
}

export async function setReviewsAutoPublishAction(form: FormData) {
  const { shop, db } = await requireShop("reviews");
  await setGrowthSettings(db, shop.id, { reviewsAutoPublish: form.get("reviewsAutoPublish") === "on" });
  revalidatePath("/admin/reviews");
}

export type ReviewRequestState = { error?: string; saved?: number };

/** How many days after delivery buyers are asked for a review; 0 turns it off. */
export async function setReviewRequestDaysAction(_: ReviewRequestState, form: FormData): Promise<ReviewRequestState> {
  const { shop, db, user } = await requireShop("reviews");
  const on = form.get("enabled") === "on";
  const days = on ? Number.parseInt(String(form.get("days") ?? ""), 10) : 0;
  try {
    await setReviewRequestDays(db, shop.id, Number.isNaN(days) ? -1 : days);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await logged({ shop, user, db }, days ? `Set review requests to go out ${days} ${days === 1 ? "day" : "days"} after delivery` : "Turned off review requests", { href: "/admin/reviews" });
  revalidatePath("/admin/reviews");
  return { saved: days };
}

export async function moderateReviewAction(id: string, status: "published" | "hidden") {
  const { shop, db } = await requireShop("reviews");
  await moderateReview(db, shop.id, id, { status });
  revalidatePath("/admin/reviews");
  revalidatePath("/admin", "layout");
}

/** Takes down one photo a buyer added to their review. */
export async function removeReviewPhotoAction(id: string, photoId: string) {
  const { shop, db } = await requireShop("reviews");
  await moderateReview(db, shop.id, id, { removePhotoId: photoId });
  revalidatePath("/admin/reviews");
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

export async function setBirthdayOfferAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("marketing");
  try {
    const int = (name: string) => Number.parseInt(String(form.get(name) ?? "").trim() || "NaN", 10);
    await setBirthdayOffer(db, shop.id, form.get("on") === "on" ? { percentOff: int("percentOff"), days: int("days") } : null);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/marketing");
  return { saved: true };
}
