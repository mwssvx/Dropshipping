import Link from "next/link";
import { loadShop, storeBase, storeT } from "../data";
import { trackOrderAction } from "../actions";

export const metadata = { title: "Track your order", robots: { index: false } };

/** For buyers without an account: the order's link is emailed to the address it was placed with. */
export default async function TrackOrderPage({ params, searchParams }: { params: Promise<{ shop: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { shop: handle } = await params;
  const { sent } = await searchParams;
  await loadShop(handle);
  const [base, t] = await Promise.all([storeBase(handle), storeT(handle)]);
  return (
    <main className="max-w-lg mx-auto px-4 sm:px-6 py-12 flex flex-col gap-5">
      <h1 className="text-3xl font-bold tracking-tight">{t.trackOrder}</h1>
      <p className="text-muted">{t.trackIntro}</p>
      {sent === "1" && <p role="status" className="banner banner-success">{t.trackSent}</p>}
      {sent === "invalid" && <p role="alert" className="banner banner-critical">{t.trackInvalid}</p>}
      <form action={trackOrderAction.bind(null, handle)} className="flex flex-col gap-3">
        <div className="field">
          <label className="label" htmlFor="track-email">{t.email}</label>
          <input className="input" id="track-email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="field">
          <label className="label" htmlFor="track-number">{t.orderNumber}</label>
          <input className="input num" id="track-number" name="number" required inputMode="numeric" placeholder="1001" />
        </div>
        <button className="btn btn-primary self-start">{t.trackButton}</button>
      </form>
      <Link href={`${base}/account`} className="underline text-sm self-start">{t.trackAccount}</Link>
    </main>
  );
}
