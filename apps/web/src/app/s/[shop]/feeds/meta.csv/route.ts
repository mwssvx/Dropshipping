import { metaFeedCsv, productFeed } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeRoot } from "../../data";

export const dynamic = "force-dynamic";

/** The products for a Meta (Facebook and Instagram) catalog. ?lang=de for a language the store is shown in. */
export async function GET(request: Request, { params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const shop = await loadShop(param);
  const origin = `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("host")}${await storeRoot(param)}`;
  const { items } = await productFeed(await db(), shop, { origin, language: new URL(request.url).searchParams.get("lang") });
  return new Response(metaFeedCsv(items), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
