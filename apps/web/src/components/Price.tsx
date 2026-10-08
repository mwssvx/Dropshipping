import { formatMoney } from "@sf/core";

export function Price({ minor, compareAt, currency }: { minor: number; compareAt?: number | null; currency: string }) {
  return (
    <span className="num flex gap-2 items-baseline">
      <span className="font-semibold">{formatMoney(minor, currency)}</span>
      {compareAt != null && compareAt > minor && <s className="hint">{formatMoney(compareAt, currency)}</s>}
    </span>
  );
}
