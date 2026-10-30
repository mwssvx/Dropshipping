import { openCartLink } from "@sf/core";
import { readCart, writeCart, writeDiscountCode } from "@/lib/cart";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../../../data";

/**
 * A cart link (<store>/cart/link/abc123): what it holds is added to the shopper's cart, with its
 * code, and they land on the cart. The visit is tagged with the link's source, so its orders count.
 */
export async function GET(_: Request, { params }: { params: Promise<{ shop: string; token: string }> }) {
  const { shop: handle, token } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const link = await openCartLink(await db(), shop.id, token);
  if (!link) return new Response(null, { status: 303, headers: { Location: `${base}/cart` } });
  const cart = await readCart(shop.id);
  for (const l of link.lines) {
    const same = cart.find((c) => c.variantId === l.variantId && !c.custom);
    if (same) same.quantity = Math.min(99, same.quantity + l.quantity);
    else cart.push({ variantId: l.variantId, quantity: l.quantity });
  }
  await writeCart(shop.id, cart);
  if (link.discountCode) await writeDiscountCode(shop.id, link.discountCode);
  return new Response(null, { status: 303, headers: { Location: `${base}/cart?utm_source=${encodeURIComponent(link.source)}` } });
}
