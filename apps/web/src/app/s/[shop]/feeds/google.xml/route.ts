import { googleFeedXml, productFeed } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeRoot } from "../../data";

// Built per request: the store (and its address) comes from the URL.
export const dynamic = "force-dynamic";

/** The products for Google Merchant Center. ?lang=de for a language the store is shown in. */
export async function GET(request: Request, { params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const shop = await loadShop(param);
  const origin = `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("host")}${await storeRoot(param)}`;
  const { items } = await productFeed(await db(), shop, { origin, language: new URL(request.url).searchParams.get("lang") });
  return new Response(googleFeedXml(shop, origin, items), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
