// Ad tracking: the store loads the Meta, TikTok, Google and Pinterest tags the merchant pastes in, and tells
// them what buyers do (view a product, add to cart, start checkout, buy) so ads can be measured
// and aimed. The tags only load after the buyer agrees in the cookie banner: for every visitor, or
// only those in the EU, EEA and UK, where the law requires it. Each ID is checked against the
// platform's format, because it ends up in a script on the store.
import { eq } from "drizzle-orm";
import { schema, type AdPixels, type Db } from "@sf/db";
import { UserError } from "./errors";

type Shop = typeof schema.shops.$inferSelect;

const FORMATS = {
  meta: { re: /^\d{10,20}$/, message: "A Meta pixel ID is 10 to 20 digits, like 1234567890123456. Find it in Events Manager." },
  tiktok: { re: /^[A-Z0-9]{16,24}$/, message: "A TikTok pixel ID is 16 to 24 capital letters and digits, like CABC123DEF456GHI789J. Find it in TikTok Ads Manager under Events." },
  google: { re: /^(G|AW)-[A-Z0-9]{6,14}$/, message: "A Google tag ID starts with G- (Analytics) or AW- (Ads), like G-ABC123DEF4." },
  pinterest: { re: /^\d{13}$/, message: "A Pinterest tag ID is 13 digits, like 2612345678901. Find it in Ads Manager under Conversions." },
} as const;

/** Countries where cookies for ads need the visitor's agreement first: the EU, the rest of the EEA, the UK and Switzerland. */
export const CONSENT_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH",
]);

/** Saves the store's ad tags (empty ones are off) and who is asked before they load. */
export async function setAdPixels(db: Db, shopId: string, input: { meta?: string | null; tiktok?: string | null; google?: string | null; pinterest?: string | null; consent: "everyone" | "eu_uk" }) {
  const pixels: AdPixels = { meta: null, tiktok: null, google: null, pinterest: null };
  for (const key of ["meta", "tiktok", "google", "pinterest"] as const) {
    const raw = (input[key] ?? "").trim().replace(/\s+/g, "");
    const value = key === "meta" || key === "pinterest" ? raw : raw.toUpperCase();
    if (!value) continue;
    if (!FORMATS[key].re.test(value)) throw new UserError(FORMATS[key].message);
    pixels[key] = value;
  }
  if (input.consent !== "everyone" && input.consent !== "eu_uk") throw new UserError("Pick who is asked before ad tracking starts.");
  const adPixels = pixels.meta || pixels.tiktok || pixels.google || pixels.pinterest ? pixels : null;
  await db.update(schema.shops).set({ adPixels, cookieConsent: input.consent, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return adPixels;
}

/** The store's ad tags, rechecked so a bad value never reaches a page. Null when there are none. */
export function storePixels(shop: Pick<Shop, "adPixels">): AdPixels | null {
  const p = shop.adPixels;
  if (!p) return null;
  const ok = (key: keyof typeof FORMATS) => (p[key] && FORMATS[key].re.test(p[key]!) ? p[key]! : null);
  const clean = { meta: ok("meta"), tiktok: ok("tiktok"), google: ok("google"), pinterest: ok("pinterest") };
  return clean.meta || clean.tiktok || clean.google || clean.pinterest ? clean : null;
}

/**
 * Whether this visitor is asked before the tags load. A visitor whose country isn't known is
 * asked, to be safe.
 */
export function needsConsent(shop: Pick<Shop, "cookieConsent">, country: string | null | undefined) {
  if (shop.cookieConsent === "everyone") return true;
  return !country || CONSENT_COUNTRIES.has(country.toUpperCase());
}
