// Weights, kept in grams. Options can carry what they weigh packed, and shipping rates can be
// limited to carts up to or over a weight, so heavy orders pay more to ship.

/** The heaviest an option or a rate's limit can be: 1,000 kg. */
export const MAX_WEIGHT_GRAMS = 1_000_000;

/** "1.5 kg" or "750 g". */
export function formatWeight(grams: number) {
  if (grams < 1000) return `${grams} g`;
  return `${(grams / 1000).toLocaleString("en", { maximumFractionDigits: 2 })} kg`;
}

/** A weight typed in kilograms ("1.5", "1,5") as grams; null when empty, NaN when it isn't a number. */
export function parseKg(raw: string | null | undefined) {
  const t = (raw ?? "").trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 1000) : Number.NaN;
}
