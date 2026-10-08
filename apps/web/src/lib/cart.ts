import "server-only";
import { cookies } from "next/headers";
import type { CartLine } from "@sf/core";

const name = (shopId: string) => `sf_cart_${shopId}`;

export async function readCart(shopId: string): Promise<CartLine[]> {
  const raw = (await cookies()).get(name(shopId))?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l): l is CartLine => typeof l?.variantId === "string" && Number.isInteger(l?.quantity))
      .slice(0, 50);
  } catch {
    return [];
  }
}

export async function writeCart(shopId: string, lines: CartLine[]) {
  const jar = await cookies();
  const clean = lines.filter((l) => l.quantity > 0);
  if (!clean.length) jar.delete(name(shopId));
  else jar.set(name(shopId), JSON.stringify(clean), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
}

const codeName = (shopId: string) => `sf_code_${shopId}`;

/** The discount code the buyer applied in the cart. Checked again at checkout. */
export async function readDiscountCode(shopId: string): Promise<string | null> {
  const raw = (await cookies()).get(codeName(shopId))?.value;
  return raw && /^[A-Z0-9_-]{1,30}$/.test(raw) ? raw : null;
}

export async function writeDiscountCode(shopId: string, code: string | null) {
  const jar = await cookies();
  if (!code) jar.delete(codeName(shopId));
  else jar.set(codeName(shopId), code, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
}

const giftName = (shopId: string) => `sf_gift_${shopId}`;

/** The gift card code the buyer applied in the cart, without dashes. Checked again at checkout. */
export async function readGiftCardCode(shopId: string): Promise<string | null> {
  const raw = (await cookies()).get(giftName(shopId))?.value;
  return raw && /^[A-Z0-9]{16}$/.test(raw) ? raw : null;
}

export async function writeGiftCardCode(shopId: string, code: string | null) {
  const jar = await cookies();
  if (!code) jar.delete(giftName(shopId));
  else jar.set(giftName(shopId), code, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
}
