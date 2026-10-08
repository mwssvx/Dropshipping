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
