import "server-only";
import { cookies, headers } from "next/headers";
import { currencyForCountry, displayFx, noConversion, shopCurrencies, type DisplayFx } from "@sf/core";
import { fxRates } from "./server";

type ShopFx = { id: string; currency: string; presentmentCurrencies: string[]; roundConvertedPrices: boolean };

export const currencyCookie = (shopId: string) => `sf_cur_${shopId}`;

/**
 * The currency this buyer shops in: the one they picked, else their country's (from the hosting
 * platform's location header) when the store sells in it, else the store's own.
 */
export async function buyerFx(shop: ShopFx): Promise<DisplayFx> {
  if (!shop.presentmentCurrencies.length) return noConversion(shop.currency);
  const picked = (await cookies()).get(currencyCookie(shop.id))?.value;
  const wanted = picked && shopCurrencies(shop).includes(picked) ? picked : currencyForCountry(shop, (await headers()).get("x-vercel-ip-country"));
  return displayFx(fxRates(), shop, wanted);
}

/** The buyer's country from the hosting platform's location header, when it gives one. */
export async function buyerCountry() {
  return (await headers()).get("x-vercel-ip-country");
}

/** The cookie a shopper's own "Deliver to" choice is kept in, for every store. */
export const countryCookie = "sf_country";

/** The country the shopper picked under "Deliver to", when they picked one. */
export async function chosenCountry() {
  const v = (await cookies()).get(countryCookie)?.value?.toUpperCase();
  return v && /^[A-Z]{2}$/.test(v) ? v : null;
}

/**
 * The country shipping, delivery dates and duties are shown for: the shopper's "Deliver to"
 * choice, else where they are. Laws that follow where the shopper is (cookie consent, the EU's
 * lowest-price rule) keep using `buyerCountry`.
 */
export async function deliveryCountry() {
  return (await chosenCountry()) ?? (await buyerCountry());
}
