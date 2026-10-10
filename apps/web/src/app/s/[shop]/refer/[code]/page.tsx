import Link from "next/link";
import { formatMoney, referrerFor } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase, storeT } from "../../data";
import { ReferForm } from "./ReferForm";

export const metadata = { title: "A gift from a friend", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Where a refer-a-friend link lands. The friend's code is emailed, never shown here. */
export default async function ReferPage({ params }: { params: Promise<{ shop: string; code: string }> }) {
  const { shop: handle, code } = await params;
  const shop = await loadShop(handle);
  const [base, t] = await Promise.all([storeBase(handle), storeT(handle)]);
  const program = shop.referralProgram;
  const referrer = await referrerFor(await db(), shop, code.toUpperCase());
  if (!program || !referrer) {
    return (
      <main className="max-w-lg mx-auto px-4 sm:px-6 py-12 flex flex-col gap-5">
        <p className="text-muted">{t.referGone}</p>
        <Link href={base || "/"} className="btn btn-primary self-start">{t.keepShopping}</Link>
      </main>
    );
  }
  return (
    <main className="max-w-lg mx-auto px-4 sm:px-6 py-12 flex flex-col gap-5">
      <h1 className="text-3xl font-bold tracking-tight">{t.referLanding(referrer.firstName, program.friendPercentOff)}</h1>
      <p className="text-muted">{t.referLandingBody(program.friendPercentOff, program.minSubtotalMinor ? formatMoney(program.minSubtotalMinor, shop.currency) : null)}</p>
      <ReferForm
        handle={handle}
        code={code.toUpperCase()}
        labels={{ email: t.email, button: t.referButton, sent: t.referSent("{email}"), invalid: t.referInvalid, gone: t.referGone }}
      />
      <Link href={base || "/"} className="underline text-sm self-start">{t.keepShopping}</Link>
    </main>
  );
}
