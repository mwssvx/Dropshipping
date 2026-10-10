import Link from "next/link";
import type { DisplayFx } from "@sf/core/money";
import { Price } from "./Price";

type Item = { id: string; handle: string; title: string; imageUrl: string | null; priceMinor: number; soldOut: boolean };

/** A row of the products the shopper looked at last, linking back to them. */
export function RecentlyViewed({ items, base, currency, fx, title, soldOut, className = "" }: { items: Item[]; base: string; currency: string; fx?: DisplayFx; title: string; soldOut: string; className?: string }) {
  if (!items.length) return null;
  return (
    <section className={`flex flex-col gap-4 ${className}`} aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="text-xl font-semibold">{title}</h2>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {items.map((p) => (
          <li key={p.id}>
            <Link href={`${base}/products/${p.handle}`} className="group flex flex-col gap-2">
              <span className="aspect-square rounded-md bg-sunken overflow-hidden">{p.imageUrl && <img src={p.imageUrl} alt="" className="size-full object-cover group-hover:opacity-90" />}</span>
              <span className="text-sm font-medium group-hover:underline line-clamp-2">{p.title}</span>
              {p.soldOut ? <span className="hint text-sm">{soldOut}</span> : <span className="text-sm"><Price minor={p.priceMinor} currency={currency} fx={fx} /></span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
