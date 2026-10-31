import { compactProducts, convertPrice, formatMoney, searchPages, searchProducts } from "@sf/core";
import { db } from "@/lib/server";
import { buyerFx } from "@/lib/currency";
import { loadShop, localProducts, storeBase, storeLang } from "../../data";

const LIMIT = 6;

/**
 * Search as you type: the first few products the search page would show for what's typed so far,
 * with their price in the buyer's currency, then the best few collections, pages and posts. Not counted in the store's search report; only a
 * search the buyer actually runs is.
 */
export async function GET(request: Request, { params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const shop = await loadShop(param);
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 200);
  if (q.length < 2) return Response.json({ products: [], links: [] });
  const [base, fx] = await Promise.all([storeBase(param), buyerFx(shop)]);
  const { products, showingFor } = await searchProducts(await db(), shop.id, { q }, fx);
  const others = await searchPages(await db(), shop.id, showingFor ?? q, await storeLang(param), 2);
  const items = await localProducts(param, compactProducts(products.slice(0, LIMIT)));
  const show = (m: number) => formatMoney(convertPrice(m, fx), fx.currency);
  return Response.json(
    {
      products: items.map((p) => ({
        title: p.title,
        url: `${base}/products/${p.handle}`,
        imageUrl: p.imageUrl,
        price: show(p.priceMinor),
        compareAt: p.compareAtMinor != null && p.compareAtMinor > p.priceMinor ? show(p.compareAtMinor) : null,
        soldOut: p.soldOut,
      })),
      links: [...others.collections, ...others.pages].map((l) => ({ kind: l.kind, title: l.title, url: `${base}${l.path}` })),
    },
    { headers: { "cache-control": "private, max-age=30" } },
  );
}
