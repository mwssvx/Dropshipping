import { writeDiscountCode } from "@/lib/cart";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../../data";

/**
 * A share link with a code in it (<store>/discount/MAYA15): the code is put in the buyer's cart,
 * then they land on the store, or on ?to=/products/lamp. The cart checks the code again as usual.
 */
export async function GET(request: Request, { params }: { params: Promise<{ shop: string; code: string }> }) {
  const { shop: handle, code: raw } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const code = decodeURIComponent(raw).trim().toUpperCase();
  if (/^[A-Z0-9_-]{3,30}$/.test(code)) {
    const d = await (await db()).query.discounts.findFirst({ where: (t, { and, eq }) => and(eq(t.shopId, shop.id), eq(t.code, code)) });
    // Codes made for one buyer's email aren't for sharing.
    if (d?.active && !d.email) await writeDiscountCode(shop.id, code);
  }
  const to = new URL(request.url).searchParams.get("to") ?? "/";
  const path = to.startsWith("/") && !to.startsWith("//") && !to.startsWith("/\\") ? to : "/";
  // A relative Location keeps the buyer on the address they came in on (store subdomain or custom domain).
  return new Response(null, { status: 303, headers: { Location: `${base}${path}` } });
}
