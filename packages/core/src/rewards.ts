// Rewards: buyers earn points on what they pay for goods, and swap them for store credit (a gift
// card code, emailed and put straight into their cart). Points are a ledger: earned when an
// order is paid, taken back in proportion when it's refunded, spent when swapped, and changed by
// the merchant by hand. Wholesale orders don't earn points; gift cards bought don't either.
import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { issueGiftCard, type GiftCardContext } from "./gift-cards";
import { formatMoney } from "./money";

type Shop = typeof schema.shops.$inferSelect;
type Order = typeof schema.orders.$inferSelect;

/** Points are swapped in hundreds. */
export const REWARD_STEP = 100;

const settingsSchema = z.object({
  enabled: z.boolean(),
  earnRate: z.number().int("Use a whole number of points.").min(1, "Buyers earn at least 1 point per 1.00.").max(100, "Up to 100 points per 1.00."),
  valueMinor: z.number().int().min(1, "100 points need to be worth something.").max(10_000, "100 points can be worth up to 100.00."),
});

export async function setRewardsSettings(db: Db, shopId: string, input: z.input<typeof settingsSchema>) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { enabled, earnRate, valueMinor } = parsed.data;
  await db.update(schema.shops).set({ rewardsEnabled: enabled, rewardsEarnRate: earnRate, rewardsValueMinor: valueMinor, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
}

type Terms = Pick<Shop, "rewardsEarnRate" | "rewardsValueMinor" | "currency">;

/** Points earned on an amount paid. */
export const pointsFor = (shop: Terms, amountMinor: number) => Math.max(0, Math.floor((amountMinor * shop.rewardsEarnRate) / 100));

/** Store credit for a number of points; only whole hundreds count. */
export const creditFor = (shop: Terms, points: number) => Math.floor(Math.max(points, 0) / REWARD_STEP) * shop.rewardsValueMinor;

/** "1 point per $1.00, 100 points = $1.00": how the store's rewards read to a buyer. */
export function describeRewards(shop: Terms) {
  const per = formatMoney(100, shop.currency);
  return `${shop.rewardsEarnRate === 1 ? "1 point" : `${shop.rewardsEarnRate} points`} per ${per} spent. ${REWARD_STEP} points = ${formatMoney(shop.rewardsValueMinor, shop.currency)} off.`;
}

/** What an order pays for goods: gift cards bought and the part paid with a gift card don't count. */
async function earningBase(db: Db, order: Order) {
  const lines = await db
    .select({ quantity: schema.orderLines.quantity, unit: schema.orderLines.unitPriceMinor, giftCard: schema.products.giftCard })
    .from(schema.orderLines)
    .leftJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .leftJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(eq(schema.orderLines.orderId, order.id));
  const goods = lines.filter((l) => !l.giftCard).reduce((s, l) => s + l.quantity * l.unit, 0);
  return Math.max(0, goods - order.discountMinor - order.giftCardMinor);
}

/** Points for a paid order. Safe to run again: an order earns once. */
export async function earnPoints(db: Db, orderId: string) {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order || order.paymentStatus !== "paid" || order.wholesale || !order.customerId) return 0;
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, order.shopId) });
  if (!shop?.rewardsEnabled) return 0;
  const points = pointsFor(shop, await earningBase(db, order));
  if (!points) return 0;
  const [row] = await db
    .insert(schema.rewardEntries)
    .values({ shopId: shop.id, customerId: order.customerId, points, kind: "order", orderId: order.id, refId: order.id })
    .onConflictDoNothing()
    .returning({ id: schema.rewardEntries.id });
  return row ? points : 0;
}

/**
 * A refund takes back the points the order earned, in proportion; a full refund takes back the
 * rest. Points already spent can leave a balance below zero, which later orders fill back up.
 */
export async function takeBackPoints(db: Db, order: Order, refund: { id: string; amountMinor: number }, full: boolean) {
  const entries = await db.query.rewardEntries.findMany({ where: eq(schema.rewardEntries.orderId, order.id) });
  const earned = entries.find((e) => e.kind === "order")?.points ?? 0;
  if (!earned) return 0;
  const left = earned + entries.filter((e) => e.kind === "refund").reduce((s, e) => s + e.points, 0);
  const take = full ? left : Math.min(left, Math.round((earned * refund.amountMinor) / order.totalMinor));
  if (take <= 0) return 0;
  await db
    .insert(schema.rewardEntries)
    .values({ shopId: order.shopId, customerId: entries[0]!.customerId, points: -take, kind: "refund", orderId: order.id, refId: refund.id })
    .onConflictDoNothing();
  return take;
}

async function balanceOf(db: Db, customerId: string) {
  const [{ points }] = (await db
    .select({ points: sql<number>`coalesce(sum(${schema.rewardEntries.points}), 0)::int` })
    .from(schema.rewardEntries)
    .where(eq(schema.rewardEntries.customerId, customerId))) as [{ points: number }];
  return Number(points);
}

const ENTRY_LABELS = { order: "Order", refund: "Refund", redeem: "Swapped for store credit", adjust: "From the store" } as const;

/** A buyer's points, what they're worth, and recent changes. */
export async function rewardsFor(db: Db, shop: Shop, email: string) {
  const customer = await db.query.customers.findFirst({ where: and(eq(schema.customers.shopId, shop.id), eq(schema.customers.email, email.trim().toLowerCase())) });
  if (!customer) return { points: 0, creditMinor: 0, entries: [] };
  const [points, rows] = await Promise.all([
    balanceOf(db, customer.id),
    db
      .select({ entry: schema.rewardEntries, number: schema.orders.number })
      .from(schema.rewardEntries)
      .leftJoin(schema.orders, eq(schema.orders.id, schema.rewardEntries.orderId))
      .where(eq(schema.rewardEntries.customerId, customer.id))
      .orderBy(desc(schema.rewardEntries.createdAt))
      .limit(20),
  ]);
  return {
    points,
    creditMinor: creditFor(shop, points),
    entries: rows.map(({ entry, number }) => ({
      id: entry.id,
      points: entry.points,
      at: entry.createdAt,
      label: entry.kind === "adjust" && entry.note ? entry.note : number && entry.kind !== "redeem" ? `${ENTRY_LABELS[entry.kind]} #${number}` : ENTRY_LABELS[entry.kind],
    })),
  };
}

/**
 * Swaps points for store credit: a gift card emailed to the buyer, returned here with its code so
 * the store can put it in their cart. Points come off first, so two presses can't spend them twice.
 */
export async function redeemPoints(ctx: GiftCardContext, shop: Shop, email: string, points: number) {
  if (!shop.rewardsEnabled) throw new UserError("This store's rewards are turned off.");
  if (!Number.isInteger(points) || points < REWARD_STEP || points % REWARD_STEP) throw new UserError(`Swap points in hundreds, from ${REWARD_STEP}.`);
  const creditMinor = creditFor(shop, points);
  if (creditMinor < 100) throw new UserError(`Swap at least ${Math.ceil(100 / shop.rewardsValueMinor) * REWARD_STEP} points at a time.`);
  const customer = await ctx.db.query.customers.findFirst({ where: and(eq(schema.customers.shopId, shop.id), eq(schema.customers.email, email.trim().toLowerCase())) });
  if (!customer) throw new UserError("You don't have any points yet.");
  const entry = await ctx.db.transaction(async (tx) => {
    // One swap at a time per buyer.
    await tx.execute(sql`select 1 from ${schema.customers} where ${schema.customers.id} = ${customer.id} for update`);
    const have = await balanceOf(tx as unknown as Db, customer.id);
    if (have < points) throw new UserError(have < REWARD_STEP ? "You don't have enough points yet." : `You have ${have.toLocaleString("en-US")} points.`);
    const [row] = await tx.insert(schema.rewardEntries).values({ shopId: shop.id, customerId: customer.id, points: -points, kind: "redeem" }).returning();
    return row!;
  });
  try {
    const { card, code } = await issueGiftCard(ctx, shop, { email: customer.email, amountMinor: creditMinor, note: `Rewards: ${points.toLocaleString("en-US")} points` });
    await ctx.db.update(schema.rewardEntries).set({ refId: card.id }).where(eq(schema.rewardEntries.id, entry.id));
    return { creditMinor, code, last4: card.last4 };
  } catch (e) {
    await ctx.db.delete(schema.rewardEntries).where(eq(schema.rewardEntries.id, entry.id));
    throw e;
  }
}

/** The merchant adds or takes points by hand, with a note the buyer sees. */
export async function adjustPoints(db: Db, shopId: string, customerId: string, input: { points: number; note: string }) {
  const customer = await db.query.customers.findFirst({ where: and(eq(schema.customers.id, customerId), eq(schema.customers.shopId, shopId)) });
  if (!customer) throw new NotFoundError("Customer");
  if (!Number.isInteger(input.points) || input.points === 0 || Math.abs(input.points) > 1_000_000) throw new UserError("Enter the points to add, or a minus number to take some away.");
  const note = input.note.trim().slice(0, 120);
  if (!note) throw new UserError("Add a short note. The buyer sees it next to the points.");
  await db.insert(schema.rewardEntries).values({ shopId, customerId, points: input.points, kind: "adjust", note });
  return balanceOf(db, customerId);
}

export async function customerPoints(db: Db, customerId: string) {
  return balanceOf(db, customerId);
}

/** For the Rewards page: buyers with points, what all points are worth, and the top holders. */
export async function rewardsSummary(db: Db, shop: Shop) {
  const rows = (await db
    .select({ customerId: schema.rewardEntries.customerId, email: schema.customers.email, name: schema.customers.name, points: sql<number>`sum(${schema.rewardEntries.points})::int` })
    .from(schema.rewardEntries)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.rewardEntries.customerId))
    .where(eq(schema.rewardEntries.shopId, shop.id))
    .groupBy(schema.rewardEntries.customerId, schema.customers.email, schema.customers.name)) as { customerId: string; email: string; name: string | null; points: number }[];
  const holders = rows.map((r) => ({ ...r, points: Number(r.points) })).filter((r) => r.points > 0);
  const points = holders.reduce((s, r) => s + r.points, 0);
  const [{ redeemed }] = (await db
    .select({ redeemed: sql<number>`coalesce(-sum(${schema.rewardEntries.points}), 0)::int` })
    .from(schema.rewardEntries)
    .where(and(eq(schema.rewardEntries.shopId, shop.id), eq(schema.rewardEntries.kind, "redeem")))) as [{ redeemed: number }];
  return {
    members: holders.length,
    points,
    /** What every buyer's points would be worth if all were swapped now. */
    owedMinor: holders.reduce((s, r) => s + creditFor(shop, r.points), 0),
    redeemedPoints: Number(redeemed),
    top: holders.sort((a, b) => b.points - a.points).slice(0, 10),
  };
}
