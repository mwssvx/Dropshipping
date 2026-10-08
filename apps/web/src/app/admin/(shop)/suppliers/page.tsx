import Link from "next/link";
import { listSupplierLinks } from "@sf/core";
import { requireShop, suppliers } from "@/lib/server";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const { shop, db } = await requireShop();
  const links = await listSupplierLinks(db, shop.id);
  const available = suppliers().available;
  const cj = available.find((s) => s.name === "cj");
  const demo = available.find((s) => s.name === "fake");
  const used = (name: string) => links.some((l) => l.provider === name);

  return (
    <main className="pb-12">
      <PageHeader title="Suppliers" />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-3xl">
        <p className="hint">When a customer pays, their order goes to the supplier of each item automatically, and tracking comes back to you and the customer.</p>
        <section className="card p-5 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">CJ Dropshipping</h2>
            <span className={`pill ${cj ? "pill-success" : "pill-neutral"}`}>{cj ? "Connected" : "Not connected"}</span>
          </div>
          <p className="text-sm hint">
            {cj
              ? "Import products from CJ links. Orders are placed with the cheapest shipping option and paid from your CJ wallet."
              : "Connecting needs a CJ Dropshipping account and its API key. Self-serve connect arrives with accounts; for now the key is set on the server (CJ_API_KEY)."}
          </p>
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
