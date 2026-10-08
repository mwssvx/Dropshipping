import Link from "next/link";
import { customerByToken } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../../data";
import { confirmSignupAction } from "./actions";

export const metadata = { title: "Confirm your signup", robots: { index: false } };

/** The link in the "confirm your signup" email. A button, so link checkers in inboxes can't sign people up. */
export default async function ConfirmSignupPage({ params, searchParams }: { params: Promise<{ shop: string; token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { shop: handle, token } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const customer = /^[0-9a-f]{64}$/.test(token) ? await customerByToken(await db(), shop.id, token) : null;
  const done = (await searchParams).done === "1";
  return (
    <main className="max-w-lg mx-auto px-4 sm:px-6 py-16 flex flex-col gap-4">
      {!customer ? (
        <>
          <h1 className="text-2xl font-bold tracking-tight">This link doesn&apos;t work</h1>
          <p className="text-muted">Sign up again on {shop.name}&apos;s home page and use the link in the newest email.</p>
        </>
      ) : done || customer.acceptsMarketing ? (
        <>
          <h1 className="text-2xl font-bold tracking-tight">You&apos;re signed up</h1>
          <p className="text-muted" role="status">{customer.email} will get news and offers from {shop.name}. Every email has a link to stop them.</p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold tracking-tight">Get news and offers from {shop.name}?</h1>
          <p className="text-muted">Confirm that {customer.email} should get their emails. You can stop them any time.</p>
          <form action={confirmSignupAction.bind(null, handle, token)}>
            <button className="btn btn-primary">Confirm</button>
          </form>
        </>
      )}
      <Link href={base || "/"} className="text-sm underline self-start">Back to {shop.name}</Link>
    </main>
  );
}
