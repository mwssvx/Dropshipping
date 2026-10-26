import { reorderLines, UserError } from "@sf/core";
import { readCart, writeCart, writeDiscountCode } from "@/lib/cart";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../../../data";

/**
 * The link in the second checkout reminder: puts what's still for sale from the unpaid checkout
 * back in the cart (on whatever device the email is opened), adds the reminder's code, and lands
 * on the cart. The code is checked again at checkout, against the buyer's email.
 */
export async function GET(request: Request, { params }: { params: Promise<{ shop: string; orderId: string }> }) {
  const { shop: handle, orderId } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const database = await db();
  let missing = 0;
  const order = /^[0-9a-f-]{36}$/i.test(orderId)
    ? await database.query.orders.findFirst({ where: (t, { and, eq }) => and(eq(t.id, orderId), eq(t.shopId, shop.id), eq(t.paymentStatus, "pending")), columns: { id: true, email: true } })
    : null;
  if (order) {
    try {
      const back = await reorderLines(database, shop.id, order.email, order.id);
      missing = back.missing;
      const cart = await readCart(shop.id);
      for (const l of back.lines) if (!cart.some((c) => c.variantId === l.variantId)) cart.push(l);
      await writeCart(shop.id, cart);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
    }
  }
  const code = new URL(request.url).searchParams.get("code")?.trim().toUpperCase() ?? "";
  if (/^[A-Z0-9_-]{3,30}$/.test(code)) {
    const d = await database.query.discounts.findFirst({ where: (t, { and, eq }) => and(eq(t.shopId, shop.id), eq(t.code, code)), columns: { active: true } });
    if (d?.active) await writeDiscountCode(shop.id, code);
  }
  // A relative Location keeps the buyer on the address they came in on (store subdomain or custom domain).
  return new Response(null, { status: 303, headers: { Location: `${base}/cart${missing ? `?unavailable=${missing}` : ""}` } });
}
