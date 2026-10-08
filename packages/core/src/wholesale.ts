// Selling in bulk. Two parts: quantity discounts on a product ("buy 3 or more, save 10%") for
// everyone, and wholesale prices for business buyers the merchant approves. A wholesale buyer
// signs in to their store account, gets the store's wholesale discount on everything instead of
// quantity discounts, and their order must reach the store's minimum.
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Db, type QuantityBreak } from "@sf/db";
import { z } from "zod";
import type { Mailer } from "./email";
import { NotFoundError, UserError } from "./errors";
import { formatMoney } from "./money";

type Shop = typeof schema.shops.$inferSelect;

export const MAX_QUANTITY_BREAKS = 3;
export const MAX_PERCENT_OFF = 80;

/** A unit price with a percentage off, to the cent. */
export const percentOff = (unitMinor: number, pct: number) => Math.round((unitMinor * (100 - pct)) / 100);

/** The best tier the quantity reaches, or null. Tiers are stored sorted by quantity. */
export function breakFor(tiers: QuantityBreak[], quantity: number) {
  return [...tiers].reverse().find((t) => quantity >= t.minQty) ?? null;
}

export function describeBreak(t: QuantityBreak) {
  return `Buy ${t.minQty} or more, save ${t.percentOff}%`;
}

const tierSchema = z.object({
  minQty: z.number().int().min(2, "Quantity discounts start at 2 or more.").max(99, "Quantities go up to 99."),
  percentOff: z.number().int().min(1, "Enter a discount of at least 1%.").max(MAX_PERCENT_OFF, `Discounts go up to ${MAX_PERCENT_OFF}%.`),
});

/** Saves a product's quantity discounts. Empty removes them. */
export async function setQuantityBreaks(db: Db, shopId: string, productId: string, input: QuantityBreak[]) {
  const parsed = z.array(tierSchema).max(MAX_QUANTITY_BREAKS, `Up to ${MAX_QUANTITY_BREAKS} quantity discounts per product.`).safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const tiers = [...parsed.data].sort((a, b) => a.minQty - b.minQty);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i]!.minQty === tiers[i - 1]!.minQty) throw new UserError("Each quantity discount needs a different quantity.");
    if (tiers[i]!.percentOff <= tiers[i - 1]!.percentOff) throw new UserError("Bigger quantities should get bigger discounts.");
  }
  const [row] = await db
    .update(schema.products)
    .set({ quantityBreaks: tiers, updatedAt: new Date() })
    .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
    .returning({ id: schema.products.id });
  if (!row) throw new NotFoundError("Product");
  return tiers;
}

// Wholesale settings ---------------------------------------------------------------------------

const settingsSchema = z.object({
  enabled: z.boolean(),
  percentOff: z.number().int().min(1, "Enter a wholesale discount of at least 1%.").max(MAX_PERCENT_OFF, `Wholesale discounts go up to ${MAX_PERCENT_OFF}%.`),
  minOrderMinor: z.number().int().min(0, "The minimum order can't be negative.").max(100_000_000),
});

export async function setWholesaleSettings(db: Db, shopId: string, input: z.input<typeof settingsSchema>) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { enabled, percentOff: pct, minOrderMinor } = parsed.data;
  await db
    .update(schema.shops)
    .set({ wholesaleEnabled: enabled, wholesalePercentOff: pct, wholesaleMinOrderMinor: minOrderMinor, updatedAt: new Date() })
    .where(eq(schema.shops.id, shopId));
}

export type WholesaleTerms = { percentOff: number; minOrderMinor: number };

/** The wholesale terms for a signed-in buyer, or null if they aren't an approved wholesale buyer. */
export async function wholesaleTermsFor(db: Db, shop: Shop, buyerEmail: string | null | undefined): Promise<WholesaleTerms | null> {
  if (!shop.wholesaleEnabled || !buyerEmail) return null;
  const c = await db.query.customers.findFirst({
    where: and(eq(schema.customers.shopId, shop.id), eq(schema.customers.email, buyerEmail.trim().toLowerCase())),
    columns: { wholesaleStatus: true },
  });
  return c?.wholesaleStatus === "approved" ? { percentOff: shop.wholesalePercentOff, minOrderMinor: shop.wholesaleMinOrderMinor } : null;
}

// Buyers -------------------------------------------------------------------------------------

const applicationSchema = z.object({
  company: z.string().trim().min(1, "Enter your business name.").max(120, "Keep the business name under 120 characters."),
  taxId: z.string().trim().max(60, "Keep the tax or resale number under 60 characters.").optional(),
  message: z.string().trim().max(1000, "Keep the message under 1,000 characters.").optional(),
});

/** A signed-in buyer asks for wholesale prices. The merchant sees it on the Wholesale page. */
export async function applyForWholesale(db: Db, shop: Shop, buyerEmail: string, input: z.input<typeof applicationSchema>) {
  if (!shop.wholesaleEnabled) throw new UserError(`${shop.name} doesn't sell wholesale right now.`);
  const parsed = applicationSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const c = await db.query.customers.findFirst({
    where: and(eq(schema.customers.shopId, shop.id), eq(schema.customers.email, buyerEmail.trim().toLowerCase())),
  });
  if (!c) throw new NotFoundError("Customer");
  if (c.wholesaleStatus === "approved") throw new UserError("You already have wholesale prices.");
  await db
    .update(schema.customers)
    .set({
      wholesaleStatus: "pending",
      wholesaleCompany: parsed.data.company,
      wholesaleTaxId: parsed.data.taxId || null,
      wholesaleMessage: parsed.data.message || null,
      wholesaleRequestedAt: new Date(),
    })
    .where(eq(schema.customers.id, c.id));
}

export async function wholesaleStatusFor(db: Db, shopId: string, buyerEmail: string) {
  const c = await db.query.customers.findFirst({
    where: and(eq(schema.customers.shopId, shopId), eq(schema.customers.email, buyerEmail.trim().toLowerCase())),
    columns: { wholesaleStatus: true, wholesaleCompany: true },
  });
  return c ?? { wholesaleStatus: "none" as const, wholesaleCompany: null };
}

export async function listWholesaleBuyers(db: Db, shopId: string) {
  return db.query.customers.findMany({
    where: and(eq(schema.customers.shopId, shopId), inArray(schema.customers.wholesaleStatus, ["pending", "approved"])),
    columns: { id: true, email: true, name: true, wholesaleStatus: true, wholesaleCompany: true, wholesaleTaxId: true, wholesaleMessage: true, wholesaleRequestedAt: true },
    orderBy: desc(schema.customers.wholesaleRequestedAt),
  });
}

/** Approve or decline an application, or remove an approved buyer. The buyer is emailed the outcome. */
export async function decideWholesale(
  ctx: { db: Db; mailer: Mailer; storeAddress: (shop: Shop) => string | Promise<string> },
  shop: Shop,
  customerId: string,
  decision: "approve" | "decline" | "remove",
) {
  const c = await ctx.db.query.customers.findFirst({ where: and(eq(schema.customers.id, customerId), eq(schema.customers.shopId, shop.id)) });
  if (!c) throw new NotFoundError("Customer");
  const status = decision === "approve" ? "approved" : decision === "decline" ? "declined" : "none";
  await ctx.db.update(schema.customers).set({ wholesaleStatus: status }).where(eq(schema.customers.id, c.id));
  if (decision === "remove") return;
  const store = await ctx.storeAddress(shop);
  const min = shop.wholesaleMinOrderMinor > 0 ? ` on orders of ${formatMoney(shop.wholesaleMinOrderMinor, shop.currency)} or more` : "";
  await ctx.mailer
    .send(
      decision === "approve"
        ? {
            to: c.email,
            subject: `You have wholesale prices at ${shop.name}`,
            text: `Hi,\n\n${shop.name} approved your wholesale account. Sign in at ${store}/account and you'll pay ${shop.wholesalePercentOff}% less${min}.\n`,
          }
        : {
            to: c.email,
            subject: `Your wholesale application to ${shop.name}`,
            text: `Hi,\n\n${shop.name} can't offer you wholesale prices right now. You can still shop at ${store} as usual.\n`,
          },
    )
    .catch(() => {});
}

/** The merchant adds a business buyer they already know, without an application. */
export async function addWholesaleBuyer(db: Db, shop: Shop, input: { email: string; company: string }) {
  const email = z.string().trim().toLowerCase().email("Enter the buyer's email address.").safeParse(input.email);
  if (!email.success) throw new UserError(email.error.issues[0]!.message);
  const company = input.company.trim().slice(0, 120) || null;
  await db
    .insert(schema.customers)
    .values({ shopId: shop.id, email: email.data, wholesaleStatus: "approved", wholesaleCompany: company, wholesaleRequestedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.customers.shopId, schema.customers.email],
      set: { wholesaleStatus: "approved", wholesaleCompany: company, wholesaleRequestedAt: new Date() },
    });
}

/** Applications waiting for the merchant, for the badge on the Wholesale link. */
export async function countPendingWholesale(db: Db, shopId: string) {
  const rows = await db.query.customers.findMany({
    where: and(eq(schema.customers.shopId, shopId), eq(schema.customers.wholesaleStatus, "pending")),
    columns: { id: true },
  });
  return rows.length;
}
