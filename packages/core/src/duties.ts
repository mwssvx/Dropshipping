// Import duties: a parcel crossing a border can owe customs duty or import tax on arrival. Buyers
// who aren't told refuse the parcel or open a dispute, so the store says up front either that the
// buyer pays them to customs on delivery, or that its prices already include them. Nothing is said
// for orders inside the store's own country, or between two EU countries (one customs union).
import { eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";
import { EU_VAT } from "./tax";

type Shop = typeof schema.shops.$inferSelect;
export type DutiesPolicy = Shop["duties"];
export const DUTIES_POLICIES = ["off", "buyer_pays", "included"] as const satisfies readonly DutiesPolicy[];

export async function setDuties(db: Db, shopId: string, policy: string) {
  if (!(DUTIES_POLICIES as readonly string[]).includes(policy)) throw new UserError("Pick what buyers abroad are told about import duties.");
  await db.update(schema.shops).set({ duties: policy as DutiesPolicy, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return policy as DutiesPolicy;
}

/** Whether an order from a store in `home` to `country` crosses a customs border. */
export function crossesCustoms(home: string, country: string) {
  if (home === country) return false;
  return !(home in EU_VAT && country in EU_VAT);
}

/**
 * What to tell a buyer in `country` about duties: null when nothing needs saying. `from` is where
 * the parcel leaves from, the store's country unless a product ships from a warehouse abroad.
 * Pass several for a cart: one crossing a border is enough.
 */
export function dutiesFor(shop: Pick<Shop, "duties" | "country">, country: string, from: string | null | (string | null)[] = null): Exclude<DutiesPolicy, "off"> | null {
  if (shop.duties === "off") return null;
  const origins = (Array.isArray(from) ? from : [from]).map((c) => c ?? shop.country);
  if (!origins.some((o) => crossesCustoms(o, country))) return null;
  return shop.duties;
}
