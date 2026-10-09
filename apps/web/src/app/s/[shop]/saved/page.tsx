import Link from "next/link";
import { listSaved } from "@sf/core";
import { Price } from "@/components/Price";
import { currentBuyer } from "@/lib/buyer";
import { buyerFx } from "@/lib/currency";
import { readGuestSaved } from "@/lib/saved";
import { db } from "@/lib/server";
import { SignInForm } from "../account/SignInForm";
import { priceAlertsAction, toggleSavedAction } from "../actions";
import { loadShop, storeBase } from "../data";

export const metadata = { title: "Saved items", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SavedPage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const [base, buyer, fx] = await Promise.all([storeBase(handle), currentBuyer(shop.id), buyerFx(shop)]);
  const items = await listSaved(await db(), shop.id, buyer ? { customerId: buyer.id } : { productIds: await readGuestSaved(shop.id) });
  const on = buyer?.priceAlerts ?? true;

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Saved items</h1>
        <p className="text-muted">{items.length === 0 ? "Nothing saved yet. Tap Save for later on any product to keep it here." : `${items.length} ${items.length === 1 ? "item" : "items"} you're keeping an eye on.`}</p>
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {items.map((item) => {
            const dropped = item.savedPriceMinor !== null && item.priceMinor < item.savedPriceMinor;
            return (
              <li key={item.id} className="py-4 flex items-center gap-4">
                <Link href={`${base}/products/${item.handle}`} className="sf-media size-20 rounded-lg bg-sunken overflow-hidden shrink-0">
                  {item.imageUrl && <img src={item.imageUrl} alt="" className="size-full object-cover" />}
                </Link>
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <Link href={`${base}/products/${item.handle}`} className="font-medium hover:underline">{item.title}</Link>
                  <span className="num">
                    <Price minor={item.priceMinor} currency={shop.currency} fx={fx} />
                    {dropped && <> <span className="pill pill-success ml-1">Price dropped</span></>}
                    {item.soldOut && <> <span className="pill pill-neutral ml-1">Sold out</span></>}
                  </span>
                </div>
                <form action={toggleSavedAction.bind(null, handle, item.id, "saved")}>
                  <input type="hidden" name="save" value="0" />
                  <button className="hint hover:text-critical" aria-label={`Remove ${item.title}`}>Remove</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      {buyer ? (
        <form action={priceAlertsAction.bind(null, handle, !on)} className="card p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>{on ? `We email ${buyer.email} when something you saved gets cheaper.` : "Price-drop emails are off."}</span>
          <button className="btn btn-secondary">{on ? "Stop price-drop emails" : "Email me when prices drop"}</button>
        </form>
      ) : (
        <section className="card p-6 flex flex-col gap-4" aria-labelledby="keep-heading">
          <div className="flex flex-col gap-1">
            <h2 id="keep-heading" className="font-semibold">Keep your list and hear about price drops</h2>
            <p className="hint">Sign in with your email and we&apos;ll keep these on your account and tell you when they get cheaper. No password needed.</p>
          </div>
          <SignInForm handle={handle} next="saved" />
        </section>
      )}
    </main>
  );
}
