import Link from "next/link";
import { customerByToken } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../../data";
import { unsubscribeAction } from "./actions";

export const metadata = { title: "Unsubscribe", robots: { index: false } };

/** The link at the foot of every campaign email. A button, so link checkers in inboxes can't unsubscribe people. */
export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ shop: string; token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { shop: handle, token } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const customer = await customerByToken(await db(), shop.id, token);
  const done = (await searchParams).done === "1";
  return (
    <main className="max-w-lg mx-auto px-4 sm:px-6 py-16 flex flex-col gap-4">
      {!customer ? (
        <>
          <h1 className="text-2xl font-bold tracking-tight">This link doesn&apos;t work</h1>
          <p className="text-muted">It may be from a test email. Use the link in the latest email from {shop.name}, or reply to it and they&apos;ll take you off the list.</p>
        </>
      ) : done || !customer.acceptsMarketing ? (
        <>
          <h1 className="text-2xl font-bold tracking-tight">You&apos;re unsubscribed</h1>
          <p className="text-muted" role="status">{customer.email} won&apos;t get marketing emails from {shop.name} any more. Order updates still come as usual.</p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold tracking-tight">Unsubscribe from {shop.name}?</h1>
          <p className="text-muted">{customer.email} will stop getting news and offers. Order updates still come as usual.</p>
          <form action={unsubscribeAction.bind(null, handle, token)}>
            <button className="btn btn-primary">Unsubscribe</button>
          </form>
        </>
      )}
      <Link href={base || "/"} className="text-sm underline self-start">Back to {shop.name}</Link>
    </main>
  );
}
