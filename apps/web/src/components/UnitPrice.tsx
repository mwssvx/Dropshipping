import type { Contents } from "@sf/db";
import { convertPrice, formatMoney, type DisplayFx } from "@sf/core/money";
import { formatUnitPrice, unitPrice } from "@sf/core/unit-price";

/** "€2.40 / 100 g" under a price, worked out from the price the buyer sees. Nothing when there's nothing to compare by. */
export function UnitPrice({ minor, contents, currency, fx, itemWord }: { minor: number; contents: Contents | null | undefined; currency: string; fx?: DisplayFx; itemWord: string }) {
  const shown = fx ? convertPrice(minor, fx) : minor;
  const unit = unitPrice(shown, contents);
  if (!unit) return null;
  return <span className="sf-unit-price text-xs hint num font-normal">{formatUnitPrice(formatMoney(unit.priceMinor, fx?.currency ?? currency), unit.per, itemWord)}</span>;
}
