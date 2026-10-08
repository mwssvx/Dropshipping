/** Parse a price typed by a person ("19.99", "19", "1,299.50") into minor units. */
export function parseMoney(input: string): number {
  const clean = input.replace(/[,\s]/g, "").replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new Error(`Not a price: ${input}`);
  const [whole, frac = ""] = clean.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function formatMoney(minor: number, currency: string, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}

/** How amounts show for one buyer: in the store's own currency (rate 1) or converted to theirs. */
export type DisplayFx = { currency: string; rate: number; round: boolean };

export const noConversion = (currency: string): DisplayFx => ({ currency, rate: 1, round: false });

/** A product price in the buyer's currency, rounded up to end in .99 when the store wants that. */
export function convertPrice(minor: number, fx: DisplayFx): number {
  if (fx.rate === 1) return minor;
  const exact = minor * fx.rate;
  if (!fx.round || exact < 100) return Math.round(exact);
  // 22.54 and 22.00 both become 22.99: up to the next .99, never down.
  return Math.floor(Math.round(exact) / 100) * 100 + 99;
}

/** Shipping, tax and discounts in the buyer's currency: converted, never rounded up. */
export function convertAmount(minor: number, fx: DisplayFx): number {
  return fx.rate === 1 ? minor : Math.round(minor * fx.rate);
}
