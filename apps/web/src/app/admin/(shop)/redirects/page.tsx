import { listRedirects, MAX_REDIRECTS } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { deleteRedirectAction } from "../../redirect-actions";
import { PageHeader } from "../PageHeader";
import { AddRedirectsForm } from "./AddRedirectsForm";

export const metadata = { title: "Redirects" };

export default async function RedirectsPage() {
  const { shop, db } = await requireShop("domains");
  const [list, address] = await Promise.all([listRedirects(db, shop.id), storeAddress(shop)]);
  return (
    <main className="pb-12">
      <PageHeader title="Redirects" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="hint max-w-2xl">
          Old links that should still reach the right page, like a product you renamed or pages from a store you moved here. A redirect is only used when
          nothing on your store is at that address. Changing a product&apos;s web address adds one for you.
        </p>
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="add-heading">
          <h2 id="add-heading" className="font-semibold">Add redirects</h2>
          <AddRedirectsForm />
        </section>
        <section className="card overflow-x-auto" aria-labelledby="list-heading">
          <div className="flex justify-between items-baseline gap-3 px-5 pt-4 pb-2">
            <h2 id="list-heading" className="font-semibold">Your redirects</h2>
            <span className="hint num">{list.length} of {MAX_REDIRECTS}</span>
          </div>
          {list.length === 0 ? (
            <p className="hint px-5 pb-4">None yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left hint border-b border-border">
                <tr>
                  <th className="font-medium px-5 py-2">Old address</th>
                  <th className="font-medium px-3 py-2">Goes to</th>
                  <th className="font-medium px-3 py-2 text-right">Visits</th>
                  <th className="px-5 py-2"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-2 break-all">{r.fromPath}</td>
                    <td className="px-3 py-2 break-all">
                      <a className="underline" href={r.toPath.startsWith("https://") ? r.toPath : `${address}${r.toPath}`} target="_blank" rel="noreferrer">{r.toPath}</a>
                    </td>
                    <td className="px-3 py-2 text-right num">{r.hits}</td>
                    <td className="px-5 py-2 text-right">
                      <form action={deleteRedirectAction.bind(null, r.id)}>
                        <button className="hint hover:text-critical" aria-label={`Remove redirect from ${r.fromPath}`}>Remove</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
