import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { ForbiddenError, NotFoundError, UserError } from "./errors";
import { uniqueHandle } from "./handles";

/** Launch countries: US, UK, EU members and Canada. */
export const LAUNCH_COUNTRIES = [
  "US", "GB", "CA",
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
] as const;

/**
 * More countries where sellers open a full Stripe account of their own. These stores sell in US
 * dollars (Stripe converts payouts to the local currency) and have no built-in tax rules yet.
 */
export const STRIPE_COUNTRIES = ["AU", "NZ", "CH", "NO", "JP", "SG", "HK", "MX", "AE", "MY", "TH"] as const;

/**
 * Countries where sellers can't open their own Stripe account but can still be paid: the platform
 * takes the card payment and Stripe sends the money to the seller's local bank ("cross-border
 * payouts", recipient accounts). Stripe's list changes; check it before launch (docs/accounts.md).
 */
export const CROSS_BORDER_COUNTRIES = [
  "AR", "CL", "CO", "CR", "DO", "EC", "GT", "JM", "PA", "PE", "PY", "SV", "TT", "UY",
  "IN", "ID", "PH", "VN", "KR", "TW", "LK", "BD", "PK", "KH", "MN", "MO", "BN",
  "IL", "TR", "SA", "QA", "KW", "BH", "OM", "JO",
  "EG", "MA", "TN", "ZA", "KE", "NG", "GH", "RW", "TZ", "MU", "NA", "BW",
  "KZ", "UZ", "AZ", "AM", "MD", "MK", "RS", "AL", "BA", "IS", "MC", "SM",
] as const;

/** Every country a store can be based in. */
export const STORE_COUNTRIES = [...LAUNCH_COUNTRIES, ...STRIPE_COUNTRIES, ...CROSS_BORDER_COUNTRIES] as const;

/** How a store in this country gets paid: its own Stripe account, or a cross-border payout. */
export function payoutRoute(country: string): "own_account" | "cross_border" {
  return (CROSS_BORDER_COUNTRIES as readonly string[]).includes(country) ? "cross_border" : "own_account";
}

const EURO = new Set(["AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES"]);

export function defaultCurrency(country: string): string {
  if (country === "US") return "USD";
  if (country === "GB") return "GBP";
  if (country === "CA") return "CAD";
  if (EURO.has(country)) return "EUR";
  // Other EU countries keep the euro for now; everywhere else sells in US dollars.
  if ((LAUNCH_COUNTRIES as readonly string[]).includes(country)) return "EUR";
  return "USD";
}

const RESERVED = new Set(["www", "admin", "api", "app", "checkout", "help", "status", "mail", "s"]);

const newShop = z.object({
  name: z.string().trim().min(2, "Give your store a name of at least 2 characters.").max(80),
  country: z.enum(STORE_COUNTRIES, { error: "We don't support that country yet." }),
});

export async function createShop(db: Db, userId: string, input: { name: string; country: string }) {
  const parsed = newShop.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { name, country } = parsed.data;
  const handle = await uniqueHandle(name, async (h) =>
    RESERVED.has(h) || !!(await db.query.shops.findFirst({ where: eq(schema.shops.handle, h), columns: { id: true } })),
  );
  return db.transaction(async (tx) => {
    const [shop] = await tx
      .insert(schema.shops)
      .values({ name, handle, country, currency: defaultCurrency(country), pricesIncludeTax: (LAUNCH_COUNTRIES as readonly string[]).includes(country) && country !== "US" && country !== "CA" })
      .returning();
    await tx.insert(schema.shopMembers).values({ shopId: shop!.id, userId, role: "owner" });
    return shop!;
  });
}

export async function listShopsForUser(db: Db, userId: string) {
  return db
    .select({ id: schema.shops.id, name: schema.shops.name, handle: schema.shops.handle, role: schema.shopMembers.role })
    .from(schema.shopMembers)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.shopMembers.shopId))
    .where(eq(schema.shopMembers.userId, userId))
    .orderBy(schema.shops.createdAt);
}

/** Every admin operation goes through this: the user must be a member of the shop. */
export async function requireMember(db: Db, userId: string, shopId: string) {
  const row = await db
    .select({ shop: schema.shops, role: schema.shopMembers.role })
    .from(schema.shopMembers)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.shopMembers.shopId))
    .where(and(eq(schema.shopMembers.shopId, shopId), eq(schema.shopMembers.userId, userId)))
    .limit(1);
  if (!row[0]) throw new ForbiddenError();
  return row[0];
}

export async function getShopByHandle(db: Db, handle: string) {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.handle, handle.toLowerCase()) });
  if (!shop) throw new NotFoundError("Store");
  return shop;
}
