import { reviewFeedXml } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeRoot } from "../../data";

// Built per request: the store (and its address) comes from the URL.
export const dynamic = "force-dynamic";

/** The store's published reviews for Google product ratings. */
export async function GET(request: Request, { params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const shop = await loadShop(param);
  const origin = `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("host")}${await storeRoot(param)}`;
  return new Response(await reviewFeedXml(await db(), shop, origin), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
