import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getShopByHandle, NotFoundError } from "@sf/core";
import { db } from "@/lib/server";

export const loadShop = cache(async (handle: string) => {
  try {
    return await getShopByHandle(await db(), handle);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
});
