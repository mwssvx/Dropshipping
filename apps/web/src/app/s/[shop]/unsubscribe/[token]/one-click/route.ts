import { unsubscribeByToken } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop } from "../../../data";

/** One-click unsubscribe (RFC 8058): mail apps POST here from their own Unsubscribe button. */
export async function POST(_: Request, { params }: { params: Promise<{ shop: string; token: string }> }) {
  const { shop: handle, token } = await params;
  const shop = await loadShop(handle);
  await unsubscribeByToken(await db(), shop.id, token);
  return new Response(null, { status: 204 });
}
