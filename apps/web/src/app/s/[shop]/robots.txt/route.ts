import { loadShop, storeBase } from "../data";

// Built per request: the store (and its address) comes from the URL.
export const dynamic = "force-dynamic";

/** Lets search engines in, keeps them out of carts and checkout, and points at the sitemap. */
export async function GET(request: Request, { params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  await loadShop(param);
  const base = await storeBase(param);
  const origin = `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("host")}`;
  const body = [
    "User-agent: *",
    `Disallow: ${base}/cart`,
    `Disallow: ${base}/checkout`,
    `Disallow: ${base}/pay/`,
    `Disallow: ${base}/orders/`,
    `Sitemap: ${origin}${base}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
