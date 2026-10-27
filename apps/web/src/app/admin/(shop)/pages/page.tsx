import Link from "next/link";
import { draftPolicies, listPages } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { PoliciesForm } from "./PoliciesForm";

export const metadata = { title: "Pages" };

const STARTERS = ["About us", "Shipping and returns", "Contact"];

export default async function PagesPage() {
  const { shop, db } = await requireShop("pages");
  const [pages, drafts] = await Promise.all([listPages(db, shop.id), draftPolicies(db, shop)]);
  return (
    <main className="pb-12">
      <PageHeader title="Pages" actions={<Link href="/admin/pages/new" className="btn btn-primary">Add page</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        {pages.length === 0 ? (
          <div className="card p-10 flex flex-col items-center text-center gap-3">
            <h2 className="font-semibold text-lg">Tell buyers who you are</h2>
            <p className="hint max-w-sm">Stores with clear shipping and return pages get more trust and fewer support questions. Add them to your footer menu in the theme editor.</p>
            <div className="flex gap-2 flex-wrap justify-center">
              {STARTERS.map((t) => <Link key={t} href={`/admin/pages/new?title=${encodeURIComponent(t)}`} className="btn btn-secondary">{t}</Link>)}
            </div>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table min-w-[480px]">
              <thead><tr><th>Page</th><th>Address</th><th>Status</th></tr></thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.id} className="hover:bg-sunken">
                    <td><Link href={`/admin/pages/${p.id}`} className="font-medium">{p.title}</Link></td>
                    <td className="hint">/pages/{p.handle}</td>
                    <td>{p.published ? <span className="pill pill-success">Visible</span> : <span className="pill pill-neutral">Hidden</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="policies-heading">
          <div>
            <h2 id="policies-heading" className="font-semibold">Store policies</h2>
            <p className="hint">
              Buyers, banks deciding a chargeback and ad platforms look for these before they trust a store. We write them from your settings: your
              return window, shipping rates and times, pickup and ad tracking. Read them, add the ones you want, then edit them like any page. They&apos;re a
              starting point, not legal advice.
            </p>
          </div>
          <PoliciesForm drafts={drafts} />
        </section>
      </div>
    </main>
  );
}
