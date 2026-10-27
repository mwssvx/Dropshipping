// Countries a product can't go to. Some things can't be posted everywhere: lithium batteries, knives
// to the UK, CBD, aerosols, or simply a supplier that doesn't cover a country the rest of the store
// does. A product lists the countries it can't ship to; its page tells buyers there, and checkout
// stops before payment with what to remove, instead of an order the supplier rejects later.
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { countryName, SHIPPING_COUNTRIES } from "./shipping";

/** Sets the countries a product can't ship to (empty for none). */
export async function setBlockedCountries(db: Db, shopId: string, productId: string, countries: string[]) {
  const wanted = [...new Set(countries.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const unknown = wanted.find((c) => !(SHIPPING_COUNTRIES as readonly string[]).includes(c));
  if (unknown) throw new UserError(`${unknown} isn't a country the store can ship to.`);
  const [row] = await db
    .update(schema.products)
    .set({ blockedCountries: wanted.sort(), updatedAt: new Date() })
    .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
    .returning({ blockedCountries: schema.products.blockedCountries });
  if (!row) throw new NotFoundError("Product");
  return row.blockedCountries;
}

/** Whether a product with this list can go to `country`. */
export const shipsToCountry = (blocked: string[] | null | undefined, country: string | null | undefined) => !country || !blocked?.includes(country);

/** The first cart item that can't go to `country`, as a sentence for checkout, or null. */
export function blockedItemMessage(items: { title: string; blockedCountries: string[] }[], country: string) {
  const item = items.find((i) => !shipsToCountry(i.blockedCountries, country));
  return item ? `${item.title} can't be shipped to ${countryName(country)}. Remove it from your cart to check out.` : null;
}
