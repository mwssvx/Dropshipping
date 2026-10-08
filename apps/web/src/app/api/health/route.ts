import { db } from "@/lib/server";

export const dynamic = "force-dynamic";

/** For uptime monitors: 200 when the app can reach its database, 503 when it can't. */
export async function GET() {
  const started = Date.now();
  try {
    await (await db()).query.shops.findFirst({ columns: { id: true } });
    return Response.json({ ok: true, db_ms: Date.now() - started }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
