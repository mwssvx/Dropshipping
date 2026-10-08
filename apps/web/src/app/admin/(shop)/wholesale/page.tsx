import { listWholesaleBuyers } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { AddBuyerForm, DecideButtons, SettingsForm } from "./WholesaleForms";

export const metadata = { title: "Wholesale" };

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export default async function WholesalePage() {
  const { shop, db } = await requireShop("wholesale");
  const buyers = await listWholesaleBuyers(db, shop.id);
  const pending = buyers.filter((b) => b.wholesaleStatus === "pending");
  const approved = buyers.filter((b) => b.wholesaleStatus === "approved");
  return (
    <main className="pb-12">
      <PageHeader title="Wholesale" />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-3xl">
        <p className="hint">
          Sell to shops and businesses at a lower price. Approved buyers sign in on your store and see wholesale prices everywhere.
          For everyone else, set quantity discounts on each product&apos;s page.
        </p>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="ws-settings">
          <h2 id="ws-settings" className="font-semibold">Settings</h2>
          <SettingsForm enabled={shop.wholesaleEnabled} percentOff={shop.wholesalePercentOff}
            minOrder={shop.wholesaleMinOrderMinor ? (shop.wholesaleMinOrderMinor / 100).toFixed(2) : ""} />
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="ws-pending">
          <h2 id="ws-pending" className="font-semibold">Applications {pending.length > 0 && <span className="pill pill-warning ml-1">{pending.length}</span>}</h2>
          {pending.length === 0 ? (
            <p className="hint">No applications waiting.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {pending.map((b) => (
                <li key={b.id} className="card p-5 flex flex-col gap-2" aria-label={b.wholesaleCompany ?? b.email}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{b.wholesaleCompany}</span>
                    {b.wholesaleRequestedAt && <span className="hint">Applied {date.format(b.wholesaleRequestedAt)}</span>}
                  </div>
                  <p className="text-sm">{b.email}{b.wholesaleTaxId && <span className="hint"> · Tax or resale number {b.wholesaleTaxId}</span>}</p>
                  {b.wholesaleMessage && <p className="text-sm whitespace-pre-line border-l-2 border-border pl-3">{b.wholesaleMessage}</p>}
                  <DecideButtons id={b.id} pending />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="ws-buyers">
          <h2 id="ws-buyers" className="font-semibold">Wholesale buyers</h2>
          {approved.length === 0 ? (
            <p className="hint">None yet. Approve an application, or add a buyer you already know.</p>
          ) : (
            <ul className="divide-y divide-border">
              {approved.map((b) => (
                <li key={b.id} className="py-3 flex flex-wrap items-center justify-between gap-3" aria-label={b.wholesaleCompany ?? b.email}>
                  <span className="flex flex-col">
                    <span className="font-medium">{b.wholesaleCompany ?? b.email}</span>
                    {b.wholesaleCompany && <span className="hint text-sm">{b.email}</span>}
                  </span>
                  <DecideButtons id={b.id} pending={false} />
                </li>
              ))}
            </ul>
          )}
          <AddBuyerForm />
        </section>
      </div>
    </main>
  );
}
