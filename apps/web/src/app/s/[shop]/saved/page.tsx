import Link from "next/link";
import { listSaved } from "@sf/core";
import { Price } from "@/components/Price";
import { ReferralCard } from "@/components/ReferralCard";
import { currentBuyer } from "@/lib/buyer";
import { buyerFx } from "@/lib/currency";
import { readGuestSaved } from "@/lib/saved";
import { db, storeAddress } from "@/lib/server";
import { SignInForm } from "../account/SignInForm";
import { priceAlertsAction, shareSavedAction, toggleSavedAction } from "../actions";
import { loadShop, localProducts, storeBase, storeT } from "../data";

export const metadata = { title: "Saved items", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SavedPage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const [base, buyer, fx] = await Promise.all([storeBase(handle), currentBuyer(shop.id), buyerFx(shop)]);
  const items = await localProducts(handle, await listSaved(await db(), shop.id, buyer ? { customerId: buyer.id } : { productIds: await readGuestSaved(shop.id) }));
  const t = await storeT(handle);
  const on = buyer?.priceAlerts ?? true;

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">{t.savedItems}</h1>
        <p className="text-muted">{items.length === 0 ? t.nothingSaved : t.keepingEye(items.length)}</p>
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
                    {dropped && <> <span className="pill pill-success ml-1">{t.priceDropped}</span></>}
                    {item.soldOut && <> <span className="pill pill-neutral ml-1">{t.soldOut}</span></>}
                  </span>
                </div>
                <form action={toggleSavedAction.bind(null, handle, item.id, "saved")}>
                  <input type="hidden" name="save" value="0" />
                  <button className="hint hover:text-critical" aria-label={t.removeNamed(item.title)}>{t.remove}</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      {buyer && items.length > 0 &&
        (buyer.savedShareToken ? (
          <ReferralCard id="share" title={t.shareTitle} body={t.shareNote} link={`${await storeAddress(shop)}/saved/${buyer.savedShareToken}`} labels={{ link: t.referLink, copy: t.referCopy, copied: t.referCopied }}>
            <form action={shareSavedAction.bind(null, handle, false)} className="flex flex-wrap items-center gap-3 text-sm">
              <button className="btn btn-secondary">{t.shareStop}</button>
              <span className="hint">{t.shareStopNote}</span>
            </form>
          </ReferralCard>
        ) : (
          <form action={shareSavedAction.bind(null, handle, true)} className="card p-5 flex flex-col gap-3">
            <h2 className="font-semibold">{t.shareTitle}</h2>
            <p className="text-sm text-muted">{t.shareNote}</p>
            <button className="btn btn-secondary self-start">{t.shareStart}</button>
          </form>
        ))}

      {buyer ? (
        <form action={priceAlertsAction.bind(null, handle, !on)} className="card p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>{on ? t.dropsOn(buyer.email) : t.dropsOff}</span>
          <button className="btn btn-secondary">{on ? t.stopDrops : t.startDrops}</button>
        </form>
      ) : (
        <section className="card p-6 flex flex-col gap-4" aria-labelledby="keep-heading">
          <div className="flex flex-col gap-1">
            <h2 id="keep-heading" className="font-semibold">{t.keepList}</h2>
            <p className="hint">{t.keepListNote}</p>
          </div>
          <SignInForm handle={handle} next="saved" />
        </section>
      )}
    </main>
  );
}
