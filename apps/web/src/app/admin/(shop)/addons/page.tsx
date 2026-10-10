import { bundleProductChoices, formatMoney, listAddons, MAX_ADDONS } from "@sf/core";
import { requireShop } from "@/lib/server";
import { deleteAddonAction, toggleAddonAction } from "../../addon-actions";
import { PageHeader } from "../PageHeader";
import { AddonForm } from "./AddonForm";

export const metadata = { title: "Checkout add-ons" };

export default async function AddonsPage() {
  const { shop, db } = await requireShop("marketing");
  const [addons, products] = await Promise.all([listAddons(db, shop.id), bundleProductChoices(db, shop.id)]);
  const choices = products.filter((p) => !addons.some((a) => a.productId === p.id));
  return (
    <main className="pb-12">
      <PageHeader title="Checkout add-ons" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="hint max-w-2xl">
          Offer one more product at checkout, for a little less, added with one tap. Buyers see the first add-on that isn&apos;t already in their
          cart. The add-on price holds when it&apos;s bought with something else and comes off any sale price. Wholesale buyers don&apos;t see add-ons.
        </p>
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="new-heading">
          <h2 id="new-heading" className="font-semibold">New add-on</h2>
          {addons.length >= MAX_ADDONS ? (
            <p className="hint">You have {MAX_ADDONS} add-ons, the most a store can offer. Delete one to add another.</p>
          ) : choices.length === 0 ? (
            <p className="hint">Add a product first.</p>
          ) : (
            <AddonForm products={choices} />
          )}
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="list-heading">
          <div className="flex justify-between items-baseline gap-3">
            <h2 id="list-heading" className="font-semibold">Your add-ons</h2>
            <span className="hint num">{addons.length} of {MAX_ADDONS}</span>
          </div>
          {addons.length === 0 && <p className="hint">None yet.</p>}
          <ol className="flex flex-col gap-3">
            {addons.map((a) => (
              <li key={a.id} className="card p-4 flex flex-wrap items-center gap-3" aria-label={a.title}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{a.title} <span className="hint">· {a.percentOff ? `${a.percentOff}% off` : "full price"}</span></p>
                  {a.pitch && <p className="hint text-sm">{a.pitch}</p>}
                  <p className="hint text-sm num">Bought on {a.bought} {a.bought === 1 ? "order" : "orders"} · {formatMoney(a.revenueMinor, shop.currency)} in sales</p>
                </div>
                <span className={`pill ${a.live ? "pill-success" : a.active ? "pill-warning" : "pill-neutral"}`}>
                  {a.live ? "At checkout" : a.active ? "Hidden: the product isn't on sale" : "Off"}
                </span>
                <form action={toggleAddonAction.bind(null, a.id, !a.active)}>
                  <button className="btn btn-secondary btn-sm">{a.active ? "Turn off" : "Turn on"}</button>
                </form>
                <form action={deleteAddonAction.bind(null, a.id)}>
                  <button className="hint hover:text-critical text-sm" aria-label={`Delete ${a.title}`}>Delete</button>
                </form>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
