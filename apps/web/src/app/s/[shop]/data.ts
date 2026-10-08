import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPublishedTheme, getShopByHandle, getShopByHostname, NotFoundError } from "@sf/core";
import { db } from "@/lib/server";
import { STORE_HOST_HEADER } from "@/lib/brand";

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
 * Where store links start. On the store's own address (subdomain or custom domain) links are
 * plain paths like /cart; on the platform address they are /s/<handle>/cart.
 */
export const storeBase = cache(async (param: string) => {
  if ((await headers()).get(STORE_HOST_HEADER)) return "";
  return `/s/${param}`;
});

export const loadTheme = cache(async (param: string) => {
  const shop = await loadShop(param);
  return getPublishedTheme(await db(), shop);
});
