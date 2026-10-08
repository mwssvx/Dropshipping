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
