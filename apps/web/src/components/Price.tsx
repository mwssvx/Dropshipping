import { convertPrice, formatMoney, type DisplayFx } from "@sf/core/money";

/** A price in the store's currency, or converted to the buyer's when fx is given. */
export function Price({ minor, compareAt, currency, fx }: { minor: number; compareAt?: number | null; currency: string; fx?: DisplayFx }) {
  const show = (m: number) => (fx ? formatMoney(convertPrice(m, fx), fx.currency) : formatMoney(m, currency));
  return (
    <span className="num flex gap-2 items-baseline">
      <span className="font-semibold">{show(minor)}</span>
      {compareAt != null && compareAt > minor && <s className="hint">{show(compareAt)}</s>}
    </span>
  );
}
