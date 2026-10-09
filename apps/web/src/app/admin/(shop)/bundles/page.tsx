import { bundleProductChoices, listBundles, MAX_BUNDLES } from "@sf/core";
import { requireShop } from "@/lib/server";
import { deleteBundleAction, toggleBundleAction } from "../../bundle-actions";
import { PageHeader } from "../PageHeader";
import { BundleForm } from "./BundleForm";

export const metadata = { title: "Bundles" };

export default async function BundlesPage() {
  const { shop, db } = await requireShop("marketing");
  const [bundles, products] = await Promise.all([
    listBundles(db, shop.id),
    bundleProductChoices(db, shop.id),
  ]);
  return (
    <main className="pb-12">
      <PageHeader title="Bundles" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="hint max-w-2xl">
          Sell products together for less. A bundle shows on each of its products&apos; pages with one button to add them all, and buyers get the
          discount on every full set in their cart. Bundles and discount codes don&apos;t combine: the cart uses whichever saves the buyer more.
        </p>
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="new-heading">
          <h2 id="new-heading" className="font-semibold">New bundle</h2>
          {products.length < 2 ? <p className="hint">Add at least two products first.</p> : <BundleForm products={products} />}
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="list-heading">
          <div className="flex justify-between items-baseline gap-3">
            <h2 id="list-heading" className="font-semibold">Your bundles</h2>
            <span className="hint num">{bundles.length} of {MAX_BUNDLES}</span>
          </div>
          {bundles.length === 0 && <p className="hint">None yet.</p>}
          <ul className="flex flex-col gap-3">
            {bundles.map((b) => (
              <li key={b.id} className="card p-4 flex flex-wrap items-center gap-3" aria-label={b.title}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{b.title} <span className="hint">· save {b.percentOff}%</span></p>
                  <p className="hint text-sm">{b.products.map((p) => p.title).join(" + ")}</p>
                </div>
                <span className={`pill ${b.live ? "pill-success" : b.active ? "pill-warning" : "pill-neutral"}`}>
                  {b.live ? "On the store" : b.active ? "Hidden: a product isn't on sale" : "Off"}
                </span>
                <form action={toggleBundleAction.bind(null, b.id, !b.active)}>
                  <button className="btn btn-secondary btn-sm">{b.active ? "Turn off" : "Turn on"}</button>
                </form>
                <form action={deleteBundleAction.bind(null, b.id)}>
                  <button className="hint hover:text-critical text-sm" aria-label={`Delete ${b.title}`}>Delete</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
