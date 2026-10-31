import { recordEvent } from "@sf/core";
import { db } from "@/lib/server";

/** Visitor events from the store (components/Track.tsx). Always 204: nothing here is for the visitor. */
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 2000) return new Response(null, { status: 204 });
    const body = JSON.parse(text) as Record<string, unknown>;
    const shopId = typeof body.shopId === "string" && /^[0-9a-f-]{36}$/i.test(body.shopId) ? body.shopId : null;
    const database = await db();
    if (shopId && (await database.query.shops.findFirst({ where: (s, { eq }) => eq(s.id, shopId), columns: { id: true } }))) {
      await recordEvent(database, shopId, {
        sessionId: String(body.sessionId ?? ""),
        kind: String(body.kind ?? ""),
        productId: typeof body.productId === "string" ? body.productId : null,
        postId: typeof body.postId === "string" ? body.postId : null,
        referrer: typeof body.referrer === "string" ? body.referrer.slice(0, 500) : null,
        utmSource: typeof body.utmSource === "string" ? body.utmSource.slice(0, 100) : null,
        host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
      });
    }
  } catch {
    // Bad JSON or a lost write: analytics never gets in the visitor's way.
  }
  return new Response(null, { status: 204 });
}
