// Refer a friend. A buyer shares their link (<store>/refer/<code>); a friend who opens it asks for
// a personal code by email, good once for a percentage off a first order; and when that order is
// delivered, the buyer who shared the link gets store credit as a gift card. Waiting for delivery
// means a refunded or charged-back order never earns credit.
import { randomBytes } from "node:crypto";
import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { schema, type Db, type ReferralProgram } from "@sf/db";
import { z } from "zod";
import type { CampaignContext } from "./campaigns";
import { UserError } from "./errors";
import { issueGiftCard, type GiftCardContext } from "./gift-cards";
import { formatMoney } from "./money";

type Shop = typeof schema.shops.$inferSelect;

const DAY = 86_400_000;
/** How long a friend's code works. */
export const REFERRAL_CODE_DAYS = 30;
const PAID = ["paid", "partially_refunded", "refunded"] as const;
// No 0/O or 1/I, so codes can be read out and typed from a phone.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const random = (n: number) => [...randomBytes(n)].map((b) => ALPHABET[b % ALPHABET.length]).join("");

const programSchema = z.object({
  friendPercentOff: z.number().int().min(5, "Friends get 5% to 50% off.").max(50, "Friends get 5% to 50% off."),
  rewardMinor: z.number().int().min(100, "The credit is 1.00 to 100.00.").max(10_000, "The credit is 1.00 to 100.00."),
  minSubtotalMinor: z.number().int().min(0).default(0),
});

/** Turns refer-a-friend on with these terms, or off with null. Codes and links already out keep working while it's on. */
export async function setReferralProgram(db: Db, shopId: string, input: z.input<typeof programSchema> | null) {
  let program: ReferralProgram | null = null;
  if (input) {
    const parsed = programSchema.safeParse(input);
    if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
    program = parsed.data;
  }
  await db.update(schema.shops).set({ referralProgram: program, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return program;
}

/** "Give friends 10% off their first order. Get $10.00 credit when it arrives." */
export function describeReferralProgram(program: ReferralProgram, currency: string) {
  const over = program.minSubtotalMinor ? ` over ${formatMoney(program.minSubtotalMinor, currency)}` : "";
  return {
    friend: `${program.friendPercentOff}% off their first order${over}`,
    reward: formatMoney(program.rewardMinor, currency),
  };
}

/** The buyer's own share code, made the first time they ask. Null when the store has the program off. */
export async function referralCodeFor(db: Db, shop: Shop, customerId: string) {
  if (!shop.referralProgram) return null;
  const customer = await db.query.customers.findFirst({ where: and(eq(schema.customers.id, customerId), eq(schema.customers.shopId, shop.id)) });
  if (!customer) return null;
  if (customer.referralCode) return customer.referralCode;
  for (let i = 0; i < 5; i++) {
    const code = random(8);
    const taken = await db.query.customers.findFirst({ where: and(eq(schema.customers.shopId, shop.id), eq(schema.customers.referralCode, code)), columns: { id: true } });
    if (taken) continue;
    await db.update(schema.customers).set({ referralCode: code }).where(and(eq(schema.customers.id, customer.id), isNull(schema.customers.referralCode)));
    // Another request may have made one first; theirs wins.
    return (await db.query.customers.findFirst({ where: eq(schema.customers.id, customer.id) }))!.referralCode!;
  }
  throw new Error("Couldn't make a unique referral code");
}

/** The buyer's code for the email on an order, for the order page. */
export async function referralCodeForEmail(db: Db, shop: Shop, email: string) {
  if (!shop.referralProgram) return null;
  const customer = await db.query.customers.findFirst({ where: and(eq(schema.customers.shopId, shop.id), eq(schema.customers.email, email.trim().toLowerCase())) });
  return customer ? referralCodeFor(db, shop, customer.id) : null;
}

/** Who shared a link, as the friend sees them: a first name, or nothing. */
export async function referrerFor(db: Db, shop: Shop, code: string) {
  if (!shop.referralProgram || !/^[A-Z2-9]{8}$/.test(code)) return null;
  const customer = await db.query.customers.findFirst({ where: and(eq(schema.customers.shopId, shop.id), eq(schema.customers.referralCode, code)) });
  if (!customer) return null;
  const order = customer.name
    ? null
    : await db.query.orders.findFirst({ where: and(eq(schema.orders.shopId, shop.id), eq(schema.orders.email, customer.email)), columns: { shippingAddress: true, gift: true } });
  const name = customer.name ?? order?.gift?.from ?? order?.shippingAddress.name ?? null;
  return { id: customer.id, email: customer.email, firstName: name?.trim().split(/\s+/)[0] || null };
}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");

/**
 * A friend asks for their code from a share link. The code goes by email only, so it reaches the
 * person who owns the address, and the answer is the same whether or not one was sent: nothing
 * goes to someone who has already ordered here, was already referred, or is the referrer.
 */
export async function claimReferral(ctx: CampaignContext, shop: Shop, code: string, rawEmail: string) {
  const program = shop.referralProgram;
  const referrer = await referrerFor(ctx.db, shop, code);
  if (!program || !referrer) throw new UserError("This link doesn't work any more.", "no_link");
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const email = parsed.data;
  if (email === referrer.email.toLowerCase()) return { sent: false };

  const [bought] = await ctx.db
    .select({ n: count() })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shop.id), sql`lower(${schema.orders.email}) = ${email}`, inArray(schema.orders.paymentStatus, [...PAID])));
  if (Number(bought?.n ?? 0) > 0) return { sent: false };

  // Claim the friend's address first, so two presses can't make two codes.
  const [referral] = await ctx.db
    .insert(schema.referrals)
    .values({ shopId: shop.id, referrerId: referrer.id, friendEmail: email })
    .onConflictDoNothing()
    .returning();
  if (!referral) return { sent: false };

  const now = ctx.now?.() ?? new Date();
  const endsAt = new Date(now.getTime() + REFERRAL_CODE_DAYS * DAY);
  let discountCode = "";
  for (let i = 0; !discountCode; i++) {
    const candidate = `FRIEND-${random(6)}`;
    const [row] = await ctx.db
      .insert(schema.discounts)
      .values({
        shopId: shop.id,
        code: candidate,
        kind: "percent",
        value: program.friendPercentOff,
        minSubtotalMinor: program.minSubtotalMinor,
        usageLimit: 1,
        oncePerCustomer: true,
        endsAt,
        source: "referral",
        email,
      })
      .onConflictDoNothing()
      .returning({ id: schema.discounts.id });
    if (row) {
      discountCode = candidate;
      await ctx.db.update(schema.referrals).set({ discountId: row.id }).where(eq(schema.referrals.id, referral.id));
    } else if (i >= 4) throw new Error("Couldn't make a unique referral code");
  }

  const from = referrer.firstName ?? "A friend";
  const until = endsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  await ctx.mailer.send({
    to: email,
    subject: `${from} gave you ${program.friendPercentOff}% off at ${shop.name}`,
    text: [
      `Hi,`,
      ``,
      `${from} thought you'd like ${shop.name}, so here's ${describeReferralProgram(program, shop.currency).friend}:`,
      ``,
      `    ${discountCode}`,
      ``,
      `Type it in your cart before ${until}. It works once, with this email address.`,
      ``,
      `Shop now: ${await ctx.storeAddress(shop)}`,
    ].join("\n"),
  });
  return { sent: true };
}

/**
 * Sends the referrer their credit for each friend whose first order, paid with the friend's code,
 * has been delivered and not refunded. Run by the scheduled job; each referral pays out once.
 */
export async function sendReferralRewards(ctx: GiftCardContext & { now?: () => Date }, opts: { shopId?: string } = {}) {
  const due = await ctx.db
    .select({ referral: schema.referrals, order: schema.orders, referrer: schema.customers, shop: schema.shops })
    .from(schema.referrals)
    .innerJoin(schema.orders, eq(schema.orders.discountId, schema.referrals.discountId))
    .innerJoin(schema.customers, eq(schema.customers.id, schema.referrals.referrerId))
    .innerJoin(schema.shops, eq(schema.shops.id, schema.referrals.shopId))
    .where(
      and(
        opts.shopId ? eq(schema.referrals.shopId, opts.shopId) : undefined,
        isNull(schema.referrals.rewardedAt),
        isNotNull(schema.referrals.discountId),
        eq(schema.orders.paymentStatus, "paid"),
        eq(schema.orders.fulfillmentStatus, "delivered"),
      ),
    )
    .limit(200);
  let sent = 0;
  for (const { referral, order, referrer, shop } of due) {
    // A store that turned the program off doesn't pay out any more.
    const program = shop.referralProgram;
    if (!program) continue;
    const now = ctx.now?.() ?? new Date();
    const [claimed] = await ctx.db
      .update(schema.referrals)
      .set({ rewardedAt: now, orderId: order.id, rewardMinor: program.rewardMinor })
      .where(and(eq(schema.referrals.id, referral.id), isNull(schema.referrals.rewardedAt)))
      .returning();
    if (!claimed) continue;
    const friend = order.shippingAddress.name.trim().split(/\s+/)[0] || "your friend";
    try {
      const { card } = await issueGiftCard(ctx, shop, { email: referrer.email, amountMinor: program.rewardMinor, note: `Thanks for sending ${friend} our way` });
      await ctx.db.update(schema.referrals).set({ giftCardId: card.id }).where(eq(schema.referrals.id, referral.id));
      sent++;
    } catch (e) {
      // Try again on the next run.
      await ctx.db.update(schema.referrals).set({ rewardedAt: null, orderId: null, rewardMinor: null }).where(eq(schema.referrals.id, referral.id));
      throw e;
    }
  }
  return { sent };
}

/** For the buyer's account page: friends who asked for a code, and the credit earned. */
export async function myReferrals(db: Db, shopId: string, customerId: string) {
  const rows = await db.query.referrals.findMany({ where: and(eq(schema.referrals.shopId, shopId), eq(schema.referrals.referrerId, customerId)) });
  return {
    invited: rows.length,
    rewarded: rows.filter((r) => r.rewardedAt).length,
    creditMinor: rows.reduce((s, r) => s + (r.rewardMinor ?? 0), 0),
  };
}

/** How the program is doing, for the Marketing page. */
export async function referralStats(db: Db, shopId: string) {
  const [sharers] = await db.select({ n: count() }).from(schema.customers).where(and(eq(schema.customers.shopId, shopId), isNotNull(schema.customers.referralCode)));
  const rows = await db.query.referrals.findMany({ where: eq(schema.referrals.shopId, shopId) });
  const discountIds = rows.map((r) => r.discountId).filter((x): x is string => !!x);
  const orders = discountIds.length
    ? await db.query.orders.findMany({ where: and(inArray(schema.orders.discountId, discountIds), inArray(schema.orders.paymentStatus, [...PAID])), columns: { totalMinor: true, refundedMinor: true } })
    : [];
  return {
    sharers: Number(sharers?.n ?? 0),
    friends: rows.length,
    orders: orders.length,
    salesMinor: orders.reduce((s, o) => s + o.totalMinor - o.refundedMinor, 0),
    rewarded: rows.filter((r) => r.rewardedAt).length,
    creditMinor: rows.reduce((s, r) => s + (r.rewardMinor ?? 0), 0),
  };
}
