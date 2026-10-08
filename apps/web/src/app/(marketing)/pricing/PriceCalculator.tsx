"use client";
import { useState } from "react";

type Plan = { id: string; name: string; monthlyMinor: number; feeBps: number; ordersPerMonth: number | null };

const usd = (minor: number) => `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export function PriceCalculator({ plans }: { plans: Plan[] }) {
  const [sales, setSales] = useState(2000);
  const [orders, setOrders] = useState(60);
  const rows = plans.map((p) => {
    const fits = p.ordersPerMonth === null || orders <= p.ordersPerMonth;
    return { ...p, fits, cost: p.monthlyMinor + Math.round((sales * 100 * p.feeBps) / 10_000) };
  });
  const best = rows.filter((r) => r.fits).sort((a, b) => a.cost - b.cost)[0];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label className="label" htmlFor="calc-sales">Sales a month: <span className="num">{usd(sales * 100)}</span></label>
          <input id="calc-sales" type="range" className="accent-accent" min={0} max={20000} step={100} value={sales} onChange={(e) => setSales(Number(e.target.value))} />
        </div>
        <div className="field">
          <label className="label" htmlFor="calc-orders">Orders a month: <span className="num">{orders}</span></label>
          <input id="calc-orders" type="range" className="accent-accent" min={0} max={500} step={5} value={orders} onChange={(e) => setOrders(Number(e.target.value))} />
        </div>
      </div>
      <ul className="grid gap-2 sm:grid-cols-4" aria-live="polite">
        {rows.map((r) => (
          <li key={r.id} className={`rounded-lg border p-3 flex flex-col gap-1 ${r.id === best?.id ? "border-accent bg-accent/5" : "border-border"}`} aria-label={`${r.name}: ${r.fits ? `${usd(r.cost)} a month` : "over its order limit"}`}>
            <span className="text-sm font-medium">{r.name}{r.id === best?.id && <span className="text-accent"> · cheapest</span>}</span>
            {r.fits ? <span className="text-xl font-bold num">{usd(r.cost)}</span> : <span className="hint text-sm">Over {r.ordersPerMonth} orders</span>}
          </li>
        ))}
      </ul>
      <p className="hint text-sm">Before card fees, which are the same on every plan. Free and Growth cost the same at about $2,450 a month in sales.</p>
    </div>
  );
}
