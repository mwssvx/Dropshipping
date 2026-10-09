import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { findRedirect, getShopByHandle, getShopByHostname, localizeCollections, localizedTheme, localizeProducts, NotFoundError, shopLanguages, type Language } from "@sf/core";
import { db } from "@/lib/server";
import { STORE_HOST_HEADER, STORE_LANG_HEADER, STORE_PATH_HEADER } from "@/lib/brand";
import { storeText } from "@/lib/store-text";

/** The [shop] segment is a store handle, or a custom domain when the proxy mapped one. */
export const loadShop = cache(async (param: string) => {
  const key = decodeURIComponent(param).toLowerCase();
  if (key.includes(".")) {
    const shop = await getShopByHostname(await db(), key);
    if (!shop) notFound();
    return shop;
  }
  try {
    return await getShopByHandle(await db(), key);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
});

/**
 * The language the buyer is reading the store in, from the address (/de/...), or null for the
 * store's own language. A language the store doesn't offer is a page that doesn't exist.
 */
export const storeLang = cache(async (param: string): Promise<Language | null> => {
  const lang = (await headers()).get(STORE_LANG_HEADER);
  if (!lang) return null;
  const shop = await loadShop(param);
  if (!shopLanguages(shop).includes(lang as Language)) notFound();
  return lang as Language;
});

/** The fixed words of the store (buttons, checkout) in the buyer's language. */
export const storeT = cache(async (param: string) => storeText(await storeLang(param)));

/** Where store links start, before any language: "" on the store's own address, /s/<handle> on ours. */
export const storeRoot = cache(async (param: string) => {
  if ((await headers()).get(STORE_HOST_HEADER)) return "";
  return `/s/${param}`;
});

/**
 * Where store links start. On the store's own address (subdomain or custom domain) links are
 * plain paths like /cart; on the platform address they are /s/<handle>/cart. Either way a buyer
 * reading another language keeps it: /de/cart.
 */
export const storeBase = cache(async (param: string) => {
  const lang = await storeLang(param);
  return `${await storeRoot(param)}${lang ? `/${lang}` : ""}`;
});

/** The page being shown, without the store prefix or language, for the language picker. */
export const storePath = cache(async () => (await headers()).get(STORE_PATH_HEADER) ?? "/");

export const loadTheme = cache(async (param: string) => {
  const shop = await loadShop(param);
  return localizedTheme(await db(), shop, await storeLang(param));
});


/**
 * Nothing on the store answers this path: send the buyer on if the merchant set up a redirect
 * (a renamed product, or a link from their old store), otherwise show the not-found page.
 */
export async function missing(param: string, path: string, count = true): Promise<never> {
  const shop = await loadShop(param);
  // Page metadata asks too; only the page itself counts the visit.
  const to = await findRedirect(await db(), shop.id, path, { count });
  if (!to) notFound();
  permanentRedirect(to.startsWith("https://") ? to : `${await storeBase(param)}${to}`);
}

/** Product titles (and descriptions, when given) in the buyer's language, where translated. */
export async function localProducts<T extends { id: string; title: string; descriptionHtml?: string }>(param: string, items: T[]) {
  const shop = await loadShop(param);
  return localizeProducts(await db(), shop.id, await storeLang(param), items);
}

export async function localCollections<T extends { id: string; title: string; description?: string }>(param: string, items: T[]) {
  const shop = await loadShop(param);
  return localizeCollections(await db(), shop.id, await storeLang(param), items);
}

/** Cart lines read "Product – Option"; the product part follows the buyer's language where translated. */
export async function lineTitles(handle: string, items: { variantId: string; title: string }[], variants: { id: string; productId: string; title: string }[]) {
  const byId = new Map(variants.map((v) => [v.id, v]));
  const local = await localProducts(handle, items.map((i) => ({ id: byId.get(i.variantId)?.productId ?? i.variantId, title: "" })));
  return new Map(items.map((i, n) => {
    const v = byId.get(i.variantId);
    const product = local[n]!.title;
    return [i.variantId, product && v ? (v.title === "Default" ? product : `${product} – ${v.title}`) : i.title];
  }));
}
