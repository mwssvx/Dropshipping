// Win-back emails: when a subscriber hasn't ordered for a while, the daily job emails them a
// personal code, good once, for their email only. The merchant picks how long to wait and the
// discount on the Marketing page and sees how many came back. Only buyers who said yes to emails
// get one, and each lapse gets one email: another goes only after they order again.
import { randomBytes } from "node:crypto";
import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { schema, type Db, type WinbackOffer } from "@sf/db";
import { z } from "zod";
import type { CampaignContext } from "./campaigns";
import { UserError } from "./errors";

type Shop = typeof schema.shops.$inferSelect;

const PAID = ["paid", "partially_refunded", "refunded"] as const;
const DAY = 86_400_000;
export const WINBACK_AFTER_DAYS = [30, 60, 90, 180] as const;
/** Buyers whose last order is older than the wait plus this aren't emailed: it's been too long to be welcome. */
export const WINBACK_WINDOW_DAYS = 180;
/** Emails one run of the daily job sends, across all stores. */
export const WINBACK_BATCH = 200;

const offerSchema = z.object({
  afterDays: z
    .number()
    .int()
    .refine((d) => (WINBACK_AFTER_DAYS as readonly number[]).includes(d), "Pick how long after their last order: 30, 60, 90 or 180 days."),
  percentOff: z.number().int().min(5, "The win-back offer is 5% to 50% off.").max(50, "The win-back offer is 5% to 50% off."),
  days: z.number().int().min(7, "Codes last 7 to 60 days.").max(60, "Codes last 7 to 60 days."),
});

/** Turns win-back emails on with these terms, or off with null. Codes already sent keep working. */
export async function setWinbackOffer(db: Db, shopId: string, input: z.input<typeof offerSchema> | null) {
  let offer: WinbackOffer | null = null;
  if (input) {
    const parsed = offerSchema.safeParse(input);
    if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
    offer = parsed.data;
  }
  await db.update(schema.shops).set({ winbackOffer: offer, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return offer;
}

function newCode() {
  // No 0/O or 1/I, so it can be read out and typed from a phone.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `BACK-${[...randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join("")}`;
}

/**
 * Subscribers due a win-back email now: they said yes to emails, their last paid order was between
 * `afterDays` and `afterDays` + 180 days ago, and they haven't had one since that order.
 */
function dueQuery(db: Db, shop: Pick<Shop, "id">, offer: WinbackOffer, now: Date) {
  const last = sql<Date>`max(${schema.orders.paidAt})`;
  const cutoff = new Date(now.getTime() - offer.afterDays * DAY);
  const oldest = new Date(cutoff.getTime() - WINBACK_WINDOW_DAYS * DAY);
  return db
    .select({ id: schema.customers.id, email: schema.customers.email, name: schema.customers.name, emailToken: schema.customers.emailToken, lastOrderAt: last })
    .from(schema.customers)
    .innerJoin(
      schema.orders,
      and(
        eq(schema.orders.shopId, schema.customers.shopId),
        sql`lower(${schema.orders.email}) = ${schema.customers.email}`,
        inArray(schema.orders.paymentStatus, [...PAID]),
        isNotNull(schema.orders.paidAt),
        // Free replacements aren't a purchase.
        sql`${schema.orders.source} <> 'replacement'`,
      ),
    )
    .where(and(eq(schema.customers.shopId, shop.id), eq(schema.customers.acceptsMarketing, true), isNull(schema.customers.unsubscribedAt)))
    .groupBy(schema.customers.id)
    .having(
      and(
        sql`${last} <= ${cutoff.toISOString()}`,
        sql`${last} > ${oldest.toISOString()}`,
        sql`(${schema.customers.winbackSentAt} is null or ${schema.customers.winbackSentAt} < ${last})`,
      ),
    );
}

/** How many subscribers would get a win-back email if the job ran now, for the settings preview. */
export async function winbackDueCount(db: Db, shop: Pick<Shop, "id">, offer: WinbackOffer, now = new Date()) {
  return (await dueQuery(db, shop, offer, now)).length;
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || "there";

/** Emails the codes that are due, for one store or all of them. Returns how many went out. */
export async function sendWinbackEmails(ctx: CampaignContext, scope: { shopId?: string; limit?: number } = {}) {
  const now = ctx.now?.() ?? new Date();
  let left = scope.limit ?? WINBACK_BATCH;
  const shops = await ctx.db.query.shops.findMany({
    where: and(isNotNull(schema.shops.winbackOffer), eq(schema.shops.status, "active"), scope.shopId ? eq(schema.shops.id, scope.shopId) : undefined),
  });
  let sent = 0;
  for (const shop of shops) {
    const offer = shop.winbackOffer!;
    for (const c of await dueQuery(ctx.db, shop, offer, now).limit(left)) {
      // Claim first, so two runs at once can't send two codes.
      const [claimed] = await ctx.db
        .update(schema.customers)
        .set({ winbackSentAt: now })
        .where(and(eq(schema.customers.id, c.id), sql`(${schema.customers.winbackSentAt} is null or ${schema.customers.winbackSentAt} < ${new Date(c.lastOrderAt).toISOString()})`))
        .returning({ id: schema.customers.id });
      if (!claimed) continue;
      const endsAt = new Date(now.getTime() + offer.days * DAY);
      let code = newCode();
      for (let i = 0; ; i++) {
        const [row] = await ctx.db
          .insert(schema.discounts)
          .values({ shopId: shop.id, code, kind: "percent", value: offer.percentOff, usageLimit: 1, oncePerCustomer: true, endsAt, source: "winback", email: c.email })
          .onConflictDoNothing()
          .returning({ id: schema.discounts.id });
        if (row) break;
        if (i >= 4) throw new Error("Couldn't make a unique win-back code");
        code = newCode();
      }
      const base = await ctx.storeAddress(shop);
      const unsubscribe = `${base}/unsubscribe/${c.emailToken}`;
      const until = endsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
      await ctx.mailer.send({
        to: c.email,
        subject: `We miss you at ${shop.name}: ${offer.percentOff}% off your next order`,
        text: [
          `Hi ${firstName(c.name)},`,
          ``,
          `It's been a while since your last order from ${shop.name}, so here's ${offer.percentOff}% off your next one:`,
          ``,
          `    ${code}`,
          ``,
          `Type it in your cart before ${until}. It works once, with this email address.`,
          ``,
          `See what's new: ${base}`,
          ``,
          "—",
          `${shop.name}${shop.mailingAddress ? ` · ${shop.mailingAddress.replace(/\s*\n\s*/g, ", ")}` : ""}`,
          `You're getting this because you said yes to emails from ${shop.name}.`,
          `Unsubscribe: ${unsubscribe}`,
        ].join("\n"),
        headers: { "List-Unsubscribe": `<${unsubscribe}/one-click>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      sent++;
      if (--left <= 0) return { sent };
    }
  }
  return { sent };
}

/** How win-back emails are doing: codes sent, and paid orders and sales that used one. */
export async function winbackStats(db: Db, shopId: string) {
  const [sent] = await db.select({ n: count() }).from(schema.discounts).where(and(eq(schema.discounts.shopId, shopId), eq(schema.discounts.source, "winback")));
  const [used] = await db
    .select({ n: count(), sales: sql<number>`coalesce(sum(${schema.orders.totalMinor}), 0)::bigint` })
    .from(schema.orders)
    .innerJoin(schema.discounts, eq(schema.discounts.id, schema.orders.discountId))
    .where(and(eq(schema.orders.shopId, shopId), eq(schema.discounts.source, "winback"), inArray(schema.orders.paymentStatus, [...PAID])));
  return { sent: Number(sent?.n ?? 0), used: Number(used?.n ?? 0), salesMinor: Number(used?.sales ?? 0) };
}
