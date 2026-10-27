import { bundleProductChoices, formatMoney, freeGiftChoices, listAddons, MAX_ADDONS } from "@sf/core";
import { requireShop } from "@/lib/server";
import { deleteAddonAction, toggleAddonAction } from "../../addon-actions";
import { PageHeader } from "../PageHeader";
import { AddonForm } from "./AddonForm";
import { FreeGiftForm } from "./FreeGiftForm";
import { TipsForm } from "./TipsForm";

export const metadata = { title: "Checkout add-ons" };

export default async function AddonsPage() {
  const { shop, db } = await requireShop("marketing");
  const [addons, products, giftChoices] = await Promise.all([listAddons(db, shop.id), bundleProductChoices(db, shop.id), freeGiftChoices(db, shop.id)]);
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
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="gift-heading">
          <h2 id="gift-heading" className="font-semibold">Free gift</h2>
          <p className="text-sm">
            Give something away with orders over an amount, like a tote bag over {formatMoney(7500, shop.currency)}. The cart tells buyers how much more
            it takes, and the gift is added to the order for free once they get there, so it&apos;s sent with everything else. The amount is what they
            pay for goods after discounts. Wholesale orders don&apos;t get one.
          </p>
          {giftChoices.length === 0 ? (
            <p className="hint">Add a product first.</p>
          ) : (
            <FreeGiftForm gift={shop.freeGift} choices={giftChoices} min={shop.freeGift ? (shop.freeGift.minSubtotalMinor / 100).toFixed(2) : ""} />
          )}
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="tips-heading" id="tips">
          <h2 id="tips-heading" className="font-semibold">Tips</h2>
          <p className="text-sm">
            Let buyers add a tip for you at checkout, as a percentage of what they&apos;re buying. &quot;No tip&quot; is always first and picked, so
            nobody tips by accident. No tax is added to a tip and we take no fee on it: every cent is yours.
          </p>
          <TipsForm tipping={shop.tipping} />
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
