import Link from "next/link";
import { listOwnSuppliers, listSupplierLinks } from "@sf/core";
import { requireShop, supplierPortalUrl, suppliers } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { AddSupplierForm, OwnSupplierCard } from "./SupplierForms";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const { shop, db } = await requireShop("suppliers");
  const [links, own] = await Promise.all([listSupplierLinks(db, shop.id), listOwnSuppliers(db, shop.id)]);
  const available = suppliers().available;
  const services = [
    {
      name: "cj",
      label: "CJ Dropshipping",
      on: "Import products from CJ links. Orders are placed with the cheapest shipping option and paid from your CJ wallet.",
      off: "Connecting needs a CJ Dropshipping account and its API key. Self-serve connect arrives with accounts; for now the key is set on the server (CJ_API_KEY).",
    },
    {
      name: "aliexpress",
      label: "AliExpress",
      on: "Import products from AliExpress item links, with each option's stock and delivery time. Orders go to each seller with the cheapest delivery and are paid with the AliExpress account's saved card. AliExpress can't cancel orders for apps, so cancel those in AliExpress.",
      off: "Connecting needs an AliExpress Open Platform app and an AliExpress account that authorises it. For now they're set on the server (ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET, ALIEXPRESS_ACCESS_TOKEN).",
    },
  ].map((s) => ({ ...s, connected: available.some((a) => a.name === s.name) }));
  const demo = available.find((s) => s.name === "fake");
  const used = (name: string) => links.some((l) => l.provider === name);

  return (
    <main className="pb-12">
      <PageHeader title="Suppliers" />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-3xl">
        <p className="hint">When a customer pays, their order goes to the supplier of each item automatically, and tracking comes back to you and the customer.</p>
        {services.map((s) => (
          <section key={s.name} className="card p-5 flex flex-col gap-2" aria-label={s.label}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{s.label}</h2>
              <span className={`pill ${s.connected ? "pill-success" : "pill-neutral"}`}>{s.connected ? "Connected" : "Not connected"}</span>
            </div>
            <p className="text-sm hint">
              {s.connected ? s.on : s.off}
              {used(s.name) ? " Some of your products use it." : ""}
            </p>
          </section>
        ))}
        <section className="flex flex-col gap-3" aria-labelledby="own-heading">
          <div className="card p-5 flex flex-col gap-3">
            <div>
              <h2 id="own-heading" className="font-semibold">Your own suppliers</h2>
              <p className="text-sm hint">
                Any wholesaler, warehouse or maker you already work with. Paid orders for their products are emailed to them with the shipping address
                (never the buyer's email), and a private link where they add tracking or tell you they can't send it. They don't need an account.
              </p>
            </div>
            <AddSupplierForm />
          </div>
          {own.length > 0 && (
            <ul className="flex flex-col gap-3">
              {own.map((s) => (
                <OwnSupplierCard key={`${s.id}-${s.name}-${s.contactEmail}`}
                  supplier={{ id: s.id, name: s.name!, email: s.contactEmail!, link: supplierPortalUrl(s.portalToken), products: s.products, openOrders: s.openOrders }} />
              ))}
            </ul>
          )}
        </section>
        {demo && (
          <section className="card p-5 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{demo.label}</h2>
              <span className="pill pill-info">Test mode</span>
            </div>
            <p className="text-sm hint">
              A pretend supplier for trying the full flow without real orders. Products from it can't ship to real customers.
              {used("fake") ? " Some of your products use it." : ""}
            </p>
            <Link href="/admin/products/import" className="btn btn-secondary self-start">Try an import</Link>
          </section>
        )}
      </div>
    </main>
  );
}
