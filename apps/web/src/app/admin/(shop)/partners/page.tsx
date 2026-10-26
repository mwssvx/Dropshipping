import { can, formatMoney, formatRate, listPartners, PARTNER_HOLD_DAYS } from "@sf/core";
import { partnerPortalUrl, requireShop, storeAddress } from "@/lib/server";
import { resetPartnerLinkAction, setPartnerActiveAction } from "../../partner-actions";
import { PageHeader } from "../PageHeader";
import { PartnerForm, PayoutForm } from "./PartnerForms";

export const metadata = { title: "Partners" };

export default async function PartnersPage() {
  const { shop, db, role } = await requireShop("marketing");
  const [partners, store] = await Promise.all([listPartners(db, shop.id), storeAddress(shop)]);
  const money = (m: number) => formatMoney(m, shop.currency);
  const seesMoney = can(role, "money");
  return (
    <main className="pb-12">
      <PageHeader title="Partners" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="hint max-w-2xl">
          Give creators and anyone who promotes your store their own code. Buyers get money off with it, and the partner gets a share of what those
          orders paid for items. Their share counts once the order is delivered, or {PARTNER_HOLD_DAYS} days after it was paid, and refunds come off.
          You pay them however you like and record it here. Each partner has a private link to see their own orders and earnings, without buyer details.
        </p>
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="add-heading">
          <h2 id="add-heading" className="font-semibold">Add a partner</h2>
          <PartnerForm />
        </section>
        {partners.length === 0 ? (
          <p className="card p-5 hint">No partners yet.</p>
        ) : (
          partners.map((p) => (
            <article key={p.id} className="card p-5 flex flex-col gap-4" aria-label={p.name}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h2 className="font-semibold">
                    {p.name} {!p.active && <span className="pill">Paused</span>}
                  </h2>
                  <p className="hint text-sm">
                    Code <span className="font-mono">{p.code}</span> · buyers get {p.percentOff}% off · they get {formatRate(p.commissionBps)}
                    {p.email ? ` · ${p.email}` : ""}
                  </p>
                </div>
                <form action={setPartnerActiveAction.bind(null, p.id, !p.active)}>
                  <button className="btn btn-secondary">{p.active ? "Pause" : "Bring back"}</button>
                </form>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Orders" value={p.orders.toLocaleString("en-US")} />
                {seesMoney && <Stat label="Items sold" value={money(p.salesMinor)} />}
                {seesMoney && <Stat label="Waiting to count" value={money(p.pendingMinor)} />}
                {seesMoney && <Stat label="Owed" value={money(p.owedMinor)} />}
              </dl>
              {seesMoney && (
                <p className="hint text-sm">
                  Earned {money(p.earnedMinor)} so far, paid {money(p.paidMinor)}.
                </p>
              )}
              {seesMoney && p.owedMinor > 0 && <PayoutForm id={p.id} name={p.name} owed={(p.owedMinor / 100).toFixed(2)} />}
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <div className="field">
                  <label className="label" htmlFor={`share-${p.id}`}>Share link (applies the code)</label>
                  <input className="input font-mono text-xs" id={`share-${p.id}`} readOnly value={`${store}/discount/${p.code}`} />
                </div>
                <div className="field">
                  <label className="label" htmlFor={`portal-${p.id}`}>Their private page</label>
                  <input className="input font-mono text-xs" id={`portal-${p.id}`} readOnly value={partnerPortalUrl(p.portalToken)} />
                  <form action={resetPartnerLinkAction.bind(null, p.id)}>
                    <button className="underline hint text-xs">Make a new link (the old one stops working)</button>
                  </form>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="hint text-sm">{label}</dt>
      <dd className="text-xl font-semibold num">{value}</dd>
    </div>
  );
}
