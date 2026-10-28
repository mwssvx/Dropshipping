// Birthday codes: a buyer can give their birthday (month and day, no year) on their store account,
// and on that day the daily job emails subscribers a code of their own, good once, for their email
// only. The merchant turns it on and picks the discount on the Marketing page. Each buyer gets one
// a year; someone born on February 29 gets theirs on the 28th in other years.
import { randomBytes } from "node:crypto";
import { and, count, eq, inArray, isNotNull, isNull, or, lt, sql } from "drizzle-orm";
import { schema, type BirthdayOffer, type Db } from "@sf/db";
import { z } from "zod";
import type { CampaignContext } from "./campaigns";
import { UserError } from "./errors";

const PAID = ["paid", "partially_refunded", "refunded"] as const;
const DAY = 86_400_000;
/** Emails one run of the daily job sends, across all stores. */
export const BIRTHDAY_BATCH = 200;

const offerSchema = z.object({
  percentOff: z.number().int().min(5, "The birthday offer is 5% to 50% off.").max(50, "The birthday offer is 5% to 50% off."),
  days: z.number().int().min(7, "Codes last 7 to 60 days.").max(60, "Codes last 7 to 60 days."),
});

/** Turns birthday codes on with these terms, or off with null. Codes already sent keep working. */
export async function setBirthdayOffer(db: Db, shopId: string, input: z.input<typeof offerSchema> | null) {
  let offer: BirthdayOffer | null = null;
  if (input) {
    const parsed = offerSchema.safeParse(input);
    if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
    offer = parsed.data;
  }
  await db.update(schema.shops).set({ birthdayOffer: offer, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return offer;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "07-14" from a month (1-12) and day, or null when either is missing. Throws on a day the month doesn't have. */
export function birthdayValue(month: number | null, day: number | null) {
  if (!month && !day) return null;
  if (!month || !day || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]!) {
    throw new UserError("Pick the month and the day of your birthday.");
  }
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A buyer sets or clears their birthday. */
export async function setBirthday(db: Db, shopId: string, email: string, month: number | null, day: number | null) {
  const birthday = birthdayValue(month, day);
  await db
    .update(schema.customers)
    .set({ birthday })
    .where(and(eq(schema.customers.shopId, shopId), eq(schema.customers.email, email.toLowerCase())));
  return birthday;
}

/** "July 14" for "07-14". */
export function formatBirthday(value: string | null | undefined) {
  const m = value?.match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(2000, Number(m[1]) - 1, Number(m[2]))).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

/** The birthdays that fall on this (UTC) day: Feb 29 birthdays move to the 28th outside leap years. */
function birthdaysOn(now: Date) {
  const mmdd = now.toISOString().slice(5, 10);
  const year = now.getUTCFullYear();
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return mmdd === "02-28" && !leap ? ["02-28", "02-29"] : [mmdd];
}

function newCode() {
  // No 0/O or 1/I, so it can be read out and typed from a phone.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `BDAY-${[...randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join("")}`;
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || "there";

/** Subscribers whose birthday is today and who haven't had this year's code. */
function dueQuery(db: Db, shopId: string, now: Date) {
  return db
    .select({ id: schema.customers.id, email: schema.customers.email, name: schema.customers.name, emailToken: schema.customers.emailToken })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.shopId, shopId),
        eq(schema.customers.acceptsMarketing, true),
        isNull(schema.customers.unsubscribedAt),
        inArray(schema.customers.birthday, birthdaysOn(now)),
        or(isNull(schema.customers.birthdaySentYear), lt(schema.customers.birthdaySentYear, now.getUTCFullYear())),
      ),
    );
}

/** Subscribers who gave their birthday, for the settings page. */
export async function birthdaysKnown(db: Db, shopId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(schema.customers)
    .where(and(eq(schema.customers.shopId, shopId), isNotNull(schema.customers.birthday), eq(schema.customers.acceptsMarketing, true), isNull(schema.customers.unsubscribedAt)));
  return Number(row?.n ?? 0);
}

/** Emails today's birthday codes, for one store or all of them. Returns how many went out. */
export async function sendBirthdayCodes(ctx: CampaignContext, scope: { shopId?: string; limit?: number } = {}) {
  const now = ctx.now?.() ?? new Date();
  const year = now.getUTCFullYear();
  let left = scope.limit ?? BIRTHDAY_BATCH;
  const shops = await ctx.db.query.shops.findMany({
    where: and(isNotNull(schema.shops.birthdayOffer), eq(schema.shops.status, "active"), scope.shopId ? eq(schema.shops.id, scope.shopId) : undefined),
  });
  let sent = 0;
  for (const shop of shops) {
    const offer = shop.birthdayOffer!;
    for (const c of await dueQuery(ctx.db, shop.id, now).limit(left)) {
      // Claim first, so two runs at once can't send two codes.
      const [claimed] = await ctx.db
        .update(schema.customers)
        .set({ birthdaySentYear: year })
        .where(and(eq(schema.customers.id, c.id), or(isNull(schema.customers.birthdaySentYear), lt(schema.customers.birthdaySentYear, year))))
        .returning({ id: schema.customers.id });
      if (!claimed) continue;
      const endsAt = new Date(now.getTime() + offer.days * DAY);
      let code = newCode();
      for (let i = 0; ; i++) {
        const [row] = await ctx.db
          .insert(schema.discounts)
          .values({ shopId: shop.id, code, kind: "percent", value: offer.percentOff, usageLimit: 1, oncePerCustomer: true, endsAt, source: "birthday", email: c.email })
          .onConflictDoNothing()
          .returning({ id: schema.discounts.id });
        if (row) break;
        if (i >= 4) throw new Error("Couldn't make a unique birthday code");
        code = newCode();
      }
      const base = await ctx.storeAddress(shop);
      const unsubscribe = `${base}/unsubscribe/${c.emailToken}`;
      const until = endsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
      await ctx.mailer.send({
        to: c.email,
        subject: `Happy birthday from ${shop.name}: ${offer.percentOff}% off`,
        text: [
          `Hi ${firstName(c.name)},`,
          ``,
          `Happy birthday! Here's ${offer.percentOff}% off anything at ${shop.name}, from us:`,
          ``,
          `    ${code}`,
          ``,
          `Type it in your cart before ${until}. It works once, with this email address.`,
          ``,
          `Treat yourself: ${base}/discount/${code}`,
          ``,
          "—",
          `${shop.name}${shop.mailingAddress ? ` · ${shop.mailingAddress.replace(/\s*\n\s*/g, ", ")}` : ""}`,
          `You're getting this because you said yes to emails from ${shop.name} and told us your birthday.`,
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

/** How birthday codes are doing: codes sent, and paid orders and sales that used one. */
export async function birthdayStats(db: Db, shopId: string) {
  const [sent] = await db.select({ n: count() }).from(schema.discounts).where(and(eq(schema.discounts.shopId, shopId), eq(schema.discounts.source, "birthday")));
  const [used] = await db
    .select({ n: count(), sales: sql<number>`coalesce(sum(${schema.orders.totalMinor}), 0)::bigint` })
    .from(schema.orders)
    .innerJoin(schema.discounts, eq(schema.discounts.id, schema.orders.discountId))
    .where(and(eq(schema.orders.shopId, shopId), eq(schema.discounts.source, "birthday"), inArray(schema.orders.paymentStatus, [...PAID])));
  return { sent: Number(sent?.n ?? 0), used: Number(used?.n ?? 0), salesMinor: Number(used?.sales ?? 0) };
}
