// Welcome offer: when someone confirms their email signup on the store, they get a personal code
// for a percentage off, good once, for that email only, for a set number of days. The merchant
// turns it on and sets the terms on the Marketing page and sees how many codes turned into orders.
import { randomBytes } from "node:crypto";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Db, type WelcomeOffer } from "@sf/db";
import { z } from "zod";
import { confirmNewsletterSignup, customerByToken, type CampaignContext } from "./campaigns";
import { UserError } from "./errors";
import { formatMoney } from "./money";

type Shop = typeof schema.shops.$inferSelect;

const PAID = ["paid", "partially_refunded", "refunded"] as const;
const DAY = 86_400_000;

const offerSchema = z.object({
  percentOff: z.number().int().min(5, "The welcome offer is 5% to 50% off.").max(50, "The welcome offer is 5% to 50% off."),
  minSubtotalMinor: z.number().int().min(0).default(0),
  days: z.number().int().min(7, "Codes last 7 to 90 days.").max(90, "Codes last 7 to 90 days."),
});

/** Turns the welcome offer on with these terms, or off with null. Codes already sent keep working. */
export async function setWelcomeOffer(db: Db, shopId: string, input: z.input<typeof offerSchema> | null) {
  let offer: WelcomeOffer | null = null;
  if (input) {
    const parsed = offerSchema.safeParse(input);
    if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
    offer = parsed.data;
  }
  await db.update(schema.shops).set({ welcomeOffer: offer, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return offer;
}

/** "10% off your first order" or "10% off your first order over $50.00", for the store and emails. */
export function describeWelcomeOffer(offer: WelcomeOffer, currency: string) {
  return `${offer.percentOff}% off your first order${offer.minSubtotalMinor ? ` over ${formatMoney(offer.minSubtotalMinor, currency)}` : ""}`;
}

function newCode() {
  // No 0/O or 1/I, so it can be read out and typed from a phone.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `WELCOME-${[...randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join("")}`;
}

/**
 * Emails a just-confirmed subscriber their code, if the store has a welcome offer. Each address
 * gets one code ever, and buyers who have already paid for an order get none, since it's for a first
 * order. Returns the code, or null when none was sent.
 */
export async function sendWelcomeCode(ctx: CampaignContext, shop: Shop, rawEmail: string) {
  const offer = shop.welcomeOffer;
  if (!offer) return null;
  const email = rawEmail.trim().toLowerCase();
  const now = ctx.now?.() ?? new Date();
  // Claim first, so two clicks on the confirm button can't send two codes.
  const [claimed] = await ctx.db
    .update(schema.customers)
    .set({ welcomeCodeAt: now })
    .where(and(eq(schema.customers.shopId, shop.id), eq(schema.customers.email, email), eq(schema.customers.acceptsMarketing, true), isNull(schema.customers.welcomeCodeAt)))
    .returning({ id: schema.customers.id });
  if (!claimed) return null;
  const [bought] = await ctx.db
    .select({ n: count() })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shop.id), sql`lower(${schema.orders.email}) = ${email}`, inArray(schema.orders.paymentStatus, [...PAID])));
  if (Number(bought?.n ?? 0) > 0) return null;

  const endsAt = new Date(now.getTime() + offer.days * DAY);
  let code = newCode();
  for (let i = 0; ; i++) {
    const [row] = await ctx.db
      .insert(schema.discounts)
      .values({
        shopId: shop.id,
        code,
        kind: "percent",
        value: offer.percentOff,
        minSubtotalMinor: offer.minSubtotalMinor,
        usageLimit: 1,
        oncePerCustomer: true,
        endsAt,
        source: "welcome",
        email,
      })
      .onConflictDoNothing()
      .returning({ id: schema.discounts.id });
    if (row) break;
    if (i >= 4) throw new Error("Couldn't make a unique welcome code");
    code = newCode();
  }

  const until = endsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  await ctx.mailer.send({
    to: email,
    subject: `Your ${offer.percentOff}% off code for ${shop.name}`,
    text: [
      `Hi,`,
      ``,
      `Thanks for signing up to ${shop.name}. Here's ${describeWelcomeOffer(offer, shop.currency)}:`,
      ``,
      `    ${code}`,
      ``,
      `Type it in your cart before ${until}. It works once, with this email address.`,
      ``,
      `Shop now: ${await ctx.storeAddress(shop)}`,
    ].join("\n"),
  });
  return { code, endsAt };
}

/**
 * The confirm button in the signup email: confirms the address and, when this is what made them a
 * subscriber, sends their welcome code. Returns null for a link that doesn't work.
 */
export async function confirmSignup(ctx: CampaignContext, shop: Shop, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const before = await customerByToken(ctx.db, shop.id, token);
  if (!before) return null;
  const row = await confirmNewsletterSignup(ctx.db, shop.id, token, ctx.now?.() ?? new Date());
  if (!row) return null;
  const welcome = before.acceptsMarketing ? null : await sendWelcomeCode(ctx, shop, row.email);
  return { email: row.email, welcome };
}

/** How the welcome offer is doing: codes sent, and paid orders and sales that used one. */
export async function welcomeOfferStats(db: Db, shopId: string) {
  const [sent] = await db.select({ n: count() }).from(schema.discounts).where(and(eq(schema.discounts.shopId, shopId), eq(schema.discounts.source, "welcome")));
  const [used] = await db
    .select({ n: count(), sales: sql<number>`coalesce(sum(${schema.orders.totalMinor}), 0)::bigint` })
    .from(schema.orders)
    .innerJoin(schema.discounts, eq(schema.discounts.id, schema.orders.discountId))
    .where(and(eq(schema.orders.shopId, shopId), eq(schema.discounts.source, "welcome"), inArray(schema.orders.paymentStatus, [...PAID])));
  return { sent: Number(sent?.n ?? 0), used: Number(used?.n ?? 0), salesMinor: Number(used?.sales ?? 0) };
}
