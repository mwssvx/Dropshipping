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
