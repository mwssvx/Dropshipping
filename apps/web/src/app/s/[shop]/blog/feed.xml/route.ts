import { listPublishedPosts, postSummary } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../../data";

export const dynamic = "force-dynamic";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The blog as an RSS feed, for feed readers and newsletter tools. */
export async function GET(request: Request, { params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const shop = await loadShop(param);
  const origin = `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("host")}${await storeBase(param)}`;
  const posts = await listPublishedPosts(await db(), shop.id, 30);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${xml(shop.name)}</title>
  <link>${xml(`${origin}/blog`)}</link>
  <description>${xml(`Guides, ideas and news from ${shop.name}.`)}</description>
${posts
  .map(
    (p) => `  <item>
    <title>${xml(p.title)}</title>
    <link>${xml(`${origin}/blog/${p.handle}`)}</link>
    <guid isPermaLink="false">${p.id}</guid>
    ${p.publishedAt ? `<pubDate>${p.publishedAt.toUTCString()}</pubDate>` : ""}
    <description>${xml(postSummary(p, 300))}</description>
  </item>`,
  )
  .join("\n")}
</channel>
</rss>
`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=900" } });
}
