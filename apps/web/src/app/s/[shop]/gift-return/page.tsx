import { findGiftOrder, returnOptions, RETURN_REASON_LABELS } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../data";
import { GiftReturnForm } from "./GiftReturnForm";

export const metadata = { title: "Return a gift", robots: { index: false } };

const day = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/**
 * For someone who got a gift: the code on the gift note finds it, and they ask for store credit
 * without the buyer hearing about it. They see what's in the parcel, never what it cost.
 */
export default async function GiftReturnPage({ params, searchParams }: { params: Promise<{ shop: string }>; searchParams: Promise<{ code?: string }> }) {
  const { shop: handle } = await params;
  const { code } = await searchParams;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const order = code ? await findGiftOrder(await db(), shop.id, code) : null;
  const options = order ? await returnOptions(await db(), shop, order, new Date(), "gift") : null;
  const latest = options?.latest;
  return (
    <main className="max-w-lg mx-auto px-4 sm:px-6 py-12 flex flex-col gap-5">
      <h1 className="text-3xl font-bold tracking-tight">Return a gift</h1>
      {!order ? (
        <>
          <p className="text-muted">Got a gift that isn&apos;t quite right? Enter the code from the gift note or the email about it. You&apos;ll get store credit, and the person who sent it won&apos;t be told.</p>
          {code && <p role="alert" className="banner banner-critical">We couldn&apos;t find a gift with that code. Check it against the gift note.</p>}
          <form action={`${base}/gift-return`} method="get" className="flex flex-col gap-3">
            <div className="field">
              <label className="label" htmlFor="gift-code">Gift return code</label>
              <input className="input font-mono uppercase" id="gift-code" name="code" required autoComplete="off" spellCheck={false} placeholder="XXXXX-XXXXX" defaultValue={code} />
            </div>
            <button className="btn btn-primary self-start">Find the gift</button>
          </form>
        </>
      ) : (
        <section className="card p-5 flex flex-col gap-4" aria-label="Your gift">
          <p className="font-semibold">A gift from {order.gift!.from}</p>
          {latest && (
            <div role="status" className="flex flex-col gap-1 text-sm">
              <p className="font-medium">
                {{
                  requested: `You asked to return ${latest.items.map((i) => i.title).join(", ")}. ${shop.name} will email you what to do next.`,
                  approved: `${shop.name} accepted your return.`,
                  credited: `${shop.name} sent your store credit by email.`,
                  declined: `${shop.name} couldn't accept this return.`,
                  refunded: `${shop.name} closed this return.`,
                  replaced: `${shop.name} closed this return.`,
                  exchanged: `${shop.name} closed this return.`,
                }[latest.status]}
              </p>
              {latest.merchantMessage && (latest.status === "approved" || latest.status === "declined") && <p className="border-l-2 border-border pl-3 whitespace-pre-line">{latest.merchantMessage}</p>}
            </div>
          )}
          {options!.blocked && !options!.open && <p className="text-sm hint">{options!.blocked}</p>}
          {options!.canRequest && (
            <>
              {options!.closesAt && <p className="text-sm hint">You can ask until {day.format(options!.closesAt)}.</p>}
              <GiftReturnForm handle={handle} code={order.gift!.returnCode!} lines={options!.lines.map((l) => ({ id: l.id, title: l.title, quantity: l.quantity }))} reasons={Object.entries(RETURN_REASON_LABELS)} />
            </>
          )}
        </section>
      )}
    </main>
  );
}
