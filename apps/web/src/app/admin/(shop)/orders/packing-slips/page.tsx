import Link from "next/link";
import { MAX_PACKING_SLIPS, packingSlips } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PackingSlipView } from "@/components/PackingSlipView";
import { PrintButton } from "@/components/PrintButton";
import { PackingSlipNoteForm } from "./PackingSlipNoteForm";

export const metadata = { title: "Packing slips" };

/** A packing slip for every order waiting for tracking, one per printed sheet. */
export default async function PackingSlipsPage() {
  const { shop, db } = await requireShop("orders");
  const { store, slips } = await packingSlips(db, shop.id, "waiting");
  return (
    <main className="px-4 sm:px-8 py-6 pb-12 flex flex-col gap-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <Link href="/admin/orders" className="hint hover:text-ink">← Orders</Link>
        {slips.length > 0 && <PrintButton>{slips.length === 1 ? "Print 1 packing slip" : `Print ${slips.length} packing slips`}</PrintButton>}
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Packing slips</h1>
      <p className="hint max-w-2xl">
        One slip per order waiting for tracking, each on its own sheet, with what goes in the box and no prices.
        {slips.length === MAX_PACKING_SLIPS ? ` Showing the oldest ${MAX_PACKING_SLIPS}; add tracking to those to see the rest.` : ""}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer underline w-fit">Note at the foot of every slip</summary>
        <PackingSlipNoteForm value={store.note ?? ""} />
      </details>
      {slips.length === 0 ? (
        <div className="card p-10 text-center hint">No orders are waiting to ship.</div>
      ) : (
        <div className="print-sheets flex flex-col gap-6">
          {slips.map((s) => <PackingSlipView key={s.orderId} slip={s} store={store} />)}
        </div>
      )}
    </main>
  );
}
