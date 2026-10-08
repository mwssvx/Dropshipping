import { notFound } from "next/navigation";
import { verifiedChecklist } from "@sf/core";
import { BRAND } from "@/lib/brand";
import { db } from "@/lib/server";
import { loadShop } from "../data";

export const metadata = { title: "Verified store" };

const day = new Intl.DateTimeFormat("en-US", { dateStyle: "long" });

/** What the badge means, in public, with this store's live numbers. */
export default async function VerifiedPage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const shop = await loadShop(param);
  if (!shop.verifiedAt || shop.status !== "active") notFound();
  const { items } = await verifiedChecklist(await db(), shop);
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="hint">Checked by {BRAND}</p>
        <h1 className="text-3xl font-bold tracking-tight">{shop.name} is a verified store</h1>
        <p className="text-muted">Verified since {day.format(shop.verifiedAt)}. We check these every day; the badge goes away if the store stops meeting them.</p>
      </div>
      <ul className="card divide-y divide-border">
        {items.map((i) => (
          <li key={i.key} className="flex items-start justify-between gap-4 p-4 text-sm">
            <span className="flex gap-3">
              <span aria-hidden className="text-accent font-bold">✓</span>
              {i.label}
            </span>
            {["shipped", "on_time", "refunds"].includes(i.key) && <span className="hint num shrink-0">{i.detail}</span>}
          </li>
        ))}
      </ul>
      <p className="hint text-sm">
        Problem with an order? Contact the store first. If that doesn&apos;t work, your card&apos;s dispute process protects you, and we look into every
        complaint we receive about a store.
      </p>
    </main>
  );
}
