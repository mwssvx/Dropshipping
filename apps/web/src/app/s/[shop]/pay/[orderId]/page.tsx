import { notFound, redirect } from "next/navigation";
import { formatMoney, getOrder, NotFoundError } from "@sf/core";
import { db, payments } from "@/lib/server";
import { SubmitButton } from "@/components/SubmitButton";
import { fakePayAction } from "../../actions";
import { loadShop, storeBase } from "../../data";

export const metadata = { title: "Payment" };

export default async function PayPage({ params }: { params: Promise<{ shop: string; orderId: string }> }) {
  const { shop: handle, orderId } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const order = await getOrder(await db(), shop.id, orderId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (order.paymentStatus === "paid") redirect(`${base}/orders/${order.paymentIntentId}`);
  const testMode = payments().name === "fake";
  return (
    <main className="max-w-md mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Payment</h1>
      <p className="text-lg num">Total due <strong>{formatMoney(order.totalMinor, order.currency)}</strong></p>
      {testMode ? (
        <form action={fakePayAction.bind(null, handle, order.id)} className="card p-5 flex flex-col gap-4">
          <p className="banner banner-info">Test mode: no real card is charged. Card payments with Apple Pay and Google Pay switch on when the store connects payouts.</p>
          <SubmitButton className="btn btn-primary btn-lg" pendingText="Paying…">Pay {formatMoney(order.totalMinor, order.currency)}</SubmitButton>
        </form>
      ) : (
        <p className="banner banner-info">Card payment form loads here (Stripe Payment Element, milestone 4).</p>
      )}
    </main>
  );
}
