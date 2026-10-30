import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError, packingSlips } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { PackingSlipView } from "@/components/PackingSlipView";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Packing slip" };

export default async function OrderPackingSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { shop, db } = await requireShop("orders");
  const { store, slips } = await packingSlips(db, shop.id, { orderId: id }).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const slip = slips[0]!;
  const giftReturns = `${await storeAddress(shop)}/gift-return`;
  return (
    <main className="px-4 sm:px-8 py-6 pb-12 flex flex-col gap-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <Link href={`/admin/orders/${slip.orderId}`} className="hint hover:text-ink">← Order #{slip.number}</Link>
        <PrintButton>Print packing slip</PrintButton>
      </div>
      <h1 className="sr-only">Packing slip for order #{slip.number}</h1>
      <div className="print-sheets flex flex-col">
        <PackingSlipView slip={slip} store={{ ...store, giftReturns }} />
      </div>
    </main>
  );
}
