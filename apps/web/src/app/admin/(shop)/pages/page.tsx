import Link from "next/link";
import { listPages } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Pages" };

const STARTERS = ["About us", "Shipping and returns", "Contact"];

export default async function PagesPage() {
  const { shop, db } = await requireShop();
  const pages = await listPages(db, shop.id);
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
      </div>
    </main>
  );
}
