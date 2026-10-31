// Thank-you codes for reviews: a store can email buyers a percent off their next order once they
// review something they bought. Every review gets it, whatever its stars, once per order, and the
// review says so on the store, so shoppers know (as the FTC and Google ask).
import { randomBytes } from "node:crypto";
import { and, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import type { Mailer } from "./email";
import { UserError } from "./errors";

export const REVIEW_REWARD_MIN = 5;
export const REVIEW_REWARD_MAX = 30;
/** How long a thank-you code works. */
export const REVIEW_REWARD_DAYS = 60;
const DAY = 86_400_000;
const PAID = ["paid", "partially_refunded", "refunded"] as const;
// No 0/O or 1/I, so codes can be read out and typed from a phone.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => `THANKS-${[...randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join("")}`;

/** Turns thank-you codes on with a percent off, or off with null. */
export async function setReviewReward(db: Db, shopId: string, percent: number | null) {
  if (percent !== null && (!Number.isInteger(percent) || percent < REVIEW_REWARD_MIN || percent > REVIEW_REWARD_MAX)) {
    throw new UserError(`Pick between ${REVIEW_REWARD_MIN}% and ${REVIEW_REWARD_MAX}% off.`);
  }
  await db.update(schema.shops).set({ reviewRewardPercent: percent, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
}

/**
 * Emails the buyer their thank-you code for a review they just left, when the store gives one and
 * the order hasn't had one yet. Returns the percent off, or null when nothing was sent.
 */
export async function rewardReview(ctx: { db: Db; mailer: Mailer; storeAddress: (shop: typeof schema.shops.$inferSelect) => string | Promise<string> }, reviewId: string, now = new Date()) {
  const { db } = ctx;
  const [row] = await db
    .select({ review: schema.reviews, shop: schema.shops, order: schema.orders })
    .from(schema.reviews)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.reviews.shopId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.reviews.orderId))
    .where(eq(schema.reviews.id, reviewId))
    .limit(1);
  const percent = row?.shop.reviewRewardPercent;
  if (!row || !percent || !row.order.email) return null;
  const { review, shop, order } = row;
  // Claim the review, and only when no other review of the order got a code: two reviews from one
  // order still earn one code, and two presses at once can't send two.
  const [claimed] = await db
    .update(schema.reviews)
    .set({ rewardedAt: now })
    .where(
      and(
        eq(schema.reviews.id, review.id),
        isNull(schema.reviews.rewardedAt),
        sql`not exists (select 1 from ${schema.reviews} r2 where r2.order_id = ${order.id} and r2.rewarded_at is not null)`,
      ),
    )
    .returning({ id: schema.reviews.id });
  if (!claimed) return null;
  const email = order.email.toLowerCase();
  const endsAt = new Date(now.getTime() + REVIEW_REWARD_DAYS * DAY);
  let code = newCode();
  for (let i = 0; ; i++) {
    const [made] = await db
      .insert(schema.discounts)
      .values({ shopId: shop.id, code, kind: "percent", value: percent, usageLimit: 1, oncePerCustomer: true, endsAt, source: "review", email })
      .onConflictDoNothing()
      .returning({ id: schema.discounts.id });
    if (made) break;
    if (i >= 4) throw new Error("Couldn't make a unique thank-you code");
    code = newCode();
  }
  const base = await ctx.storeAddress(shop);
  const until = endsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const first = order.shippingAddress?.name?.trim().split(/\s+/)[0] || "there";
  await ctx.mailer.send({
    to: order.email,
    subject: `Thanks for your review: ${percent}% off your next order`,
    text: [
      `Hi ${first},`,
      ``,
      `Thank you for reviewing your order from ${shop.name}. Here's ${percent}% off your next one, as promised:`,
      ``,
      `    ${code}`,
      ``,
      `Type it in your cart before ${until}. It works once, with this email address.`,
      ``,
      `${base}`,
      ``,
      "—",
      `${shop.name}${shop.mailingAddress ? ` · ${shop.mailingAddress.replace(/\s*\n\s*/g, ", ")}` : ""}`,
    ].join("\n"),
  });
  return percent;
}

/** Thank-you codes sent, and the paid orders and sales (after refunds) that used one. */
export async function reviewRewardStats(db: Db, shopId: string) {
  const [sent] = await db.select({ n: count() }).from(schema.discounts).where(and(eq(schema.discounts.shopId, shopId), eq(schema.discounts.source, "review")));
  const [used] = await db
    .select({ n: count(), sales: sql<number>`coalesce(sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor}), 0)::bigint` })
    .from(schema.orders)
    .innerJoin(schema.discounts, eq(schema.discounts.id, schema.orders.discountId))
    .where(and(eq(schema.orders.shopId, shopId), eq(schema.discounts.source, "review"), inArray(schema.orders.paymentStatus, [...PAID]), ne(schema.orders.source, "replacement")));
  return { sent: Number(sent?.n ?? 0), used: Number(used?.n ?? 0), salesMinor: Number(used?.sales ?? 0) };
}

