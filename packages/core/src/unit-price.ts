// Price per unit: "€2.40 / 100 g" under the price, so buyers can compare a 250 g bag with a 1 kg
// one. The EU requires it for food, drinks and household goods sold by weight, volume or length,
// and other platforms leave it to the merchant to work out. The merchant says what one variant
// holds; the price per unit follows the price, sales and the buyer's currency. Pure functions, so
// the storefront's product cards can use them in the browser too.
import type { Contents } from "@sf/db";

export const CONTENT_UNITS = ["g", "kg", "ml", "cl", "l", "cm", "m", "m2", "item"] as const satisfies readonly Contents["unit"][];
export const CONTENT_UNIT_LABELS: Record<Contents["unit"], string> = { g: "g", kg: "kg", ml: "ml", cl: "cl", l: "l", cm: "cm", m: "m", m2: "m²", item: "items" };
export const MAX_CONTENTS = 1_000_000;

const BASE: Record<Contents["unit"], { kind: "mass" | "volume" | "length" | "area" | "count"; factor: number }> = {
  g: { kind: "mass", factor: 1 },
  kg: { kind: "mass", factor: 1000 },
  ml: { kind: "volume", factor: 1 },
  cl: { kind: "volume", factor: 10 },
  l: { kind: "volume", factor: 1000 },
  cm: { kind: "length", factor: 1 },
  m: { kind: "length", factor: 100 },
  m2: { kind: "area", factor: 1 },
  item: { kind: "count", factor: 1 },
};

/** What the price per unit is "per": 100 g or 100 ml for small packs (250 or less), else 1 kg, 1 l, 1 m, 1 m² or one item. */
export type UnitReference = "100 g" | "kg" | "100 ml" | "l" | "m" | "m²" | "item";

/** The price per unit for a variant's price, or null when it holds nothing to compare by (or just one item). */
export function unitPrice(priceMinor: number, contents: Contents | null | undefined): { priceMinor: number; per: UnitReference } | null {
  if (!contents || !(contents.amount > 0) || !BASE[contents.unit]) return null;
  const { kind, factor } = BASE[contents.unit];
  const total = contents.amount * factor;
  const [per, ref]: [UnitReference, number] =
    kind === "mass" ? (total <= 250 ? ["100 g", 100] : ["kg", 1000])
    : kind === "volume" ? (total <= 250 ? ["100 ml", 100] : ["l", 1000])
    : kind === "length" ? ["m", 100]
    : kind === "area" ? ["m²", 1]
    : ["item", 1];
  if (kind === "count" && total <= 1) return null;
  return { priceMinor: Math.round((priceMinor * ref) / total), per };
}

/** "2.40 / 100 g": the formatted price and what it's per, with "item" in the store's language. */
export function formatUnitPrice(price: string, per: UnitReference, itemWord = "item") {
  return `${price} / ${per === "item" ? itemWord : per}`;
}

/** Checks what the merchant typed: a positive amount (up to 3 decimals) in a known unit, or nothing. */
export function parseContents(amount: string | number | null | undefined, unit: string | null | undefined): Contents | null {
  const text = String(amount ?? "").trim().replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  if (!(CONTENT_UNITS as readonly string[]).includes(unit ?? "")) throw new Error("unit");
  if (!Number.isFinite(n) || n <= 0 || n > MAX_CONTENTS) throw new Error("amount");
  return { amount: Math.round(n * 1000) / 1000, unit: unit as Contents["unit"] };
}

/** "250 g", "1.5 l", "6 items". */
export function formatContents(c: Contents) {
  return `${c.amount} ${c.unit === "item" ? (c.amount === 1 ? "item" : "items") : CONTENT_UNIT_LABELS[c.unit]}`;
}
