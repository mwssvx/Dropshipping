import { listPages, listCollections, listActiveProducts, listPublishedPosts } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../data";

// Built per request: the store (and its address) comes from the URL.
export const dynamic = "force-dynamic";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Every public page of the store, for search engines. Served at /sitemap.xml on the store's address. */
export async function GET(request: Request, { params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const shop = await loadShop(param);
  const database = await db();
  const origin = `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("host")}${await storeBase(param)}`;
  const [products, collections, pages, posts] = await Promise.all([
    listActiveProducts(database, shop.id),
    listCollections(database, shop.id),
    listPages(database, shop.id),
    listPublishedPosts(database, shop.id, 1000),
  ]);
  const entries: { path: string; updated?: Date }[] = [
    { path: "" },
    { path: "/collections/all" },
    ...collections.map((c) => ({ path: `/collections/${c.handle}`, updated: c.updatedAt })),
    ...products.map((p) => ({ path: `/products/${p.handle}`, updated: p.updatedAt })),
    ...pages.filter((p) => p.published).map((p) => ({ path: `/pages/${p.handle}`, updated: p.updatedAt })),
    ...(posts.length ? [{ path: "/blog", updated: posts[0]!.publishedAt ?? undefined }] : []),
    ...posts.map((p) => ({ path: `/blog/${p.handle}`, updated: p.updatedAt })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `  <url><loc>${xml(origin + e.path || "/")}</loc>${e.updated ? `<lastmod>${e.updated.toISOString()}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
