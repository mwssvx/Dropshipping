import { CART_LINK_MAX_LINES, cartLinkChoices, formatMoney, listCartLinks, listDiscounts } from "@sf/core";
import { SubmitButton } from "@/components/SubmitButton";
import { requireShop, storeAddress } from "@/lib/server";
import { deleteCartLinkAction } from "../../cart-link-actions";
import { PageHeader } from "../PageHeader";
import { CartLinkForm } from "./CartLinkForm";

export const metadata = { title: "Cart links" };

export default async function CartLinksPage() {
  const { shop, db } = await requireShop("marketing");
  const [links, choices, discounts, store] = await Promise.all([listCartLinks(db, shop.id), cartLinkChoices(db, shop.id), listDiscounts(db, shop.id), storeAddress(shop)]);
  // Codes the merchant made or gave a partner; one-off batch, personal and reward codes aren't for sharing.
  const codes = discounts.filter((d) => d.active && (d.source === "merchant" || d.source === "partner")).map((d) => d.code);
  return (
    <main className="pb-12">
      <PageHeader title="Cart links" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <p className="hint max-w-2xl">
          One link that puts chosen products in a shopper&apos;s cart, with a code if you like, and opens the cart. Send it in a DM, put it in an
          ad or give it to a creator. Anything sold out or no longer on sale when someone opens it is left out.
        </p>
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="new-link-heading">
          <h2 id="new-link-heading" className="font-semibold">New cart link</h2>
          {choices.length ? <CartLinkForm choices={choices} codes={codes} max={CART_LINK_MAX_LINES} /> : <p className="hint">Add a product first.</p>}
        </section>
        {links.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="links-heading">
            <h2 id="links-heading" className="font-semibold">Your cart links</h2>
            <ul className="flex flex-col gap-3">
              {links.map((l) => (
                <li key={l.id} className="card p-4 flex flex-col gap-3" aria-label={l.name}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-medium">{l.name}</h3>
                    <span className="text-sm hint num">
                      {l.clicks === 1 ? "1 click" : `${l.clicks} clicks`} · {l.orders === 1 ? "1 order" : `${l.orders} orders`} · {formatMoney(l.salesMinor, shop.currency)}
                    </span>
                  </div>
                  <input className="input font-mono text-xs" readOnly aria-label={`Link for ${l.name}`} value={`${store}/cart/link/${l.token}`} />
                  <ul className="text-sm flex flex-col gap-0.5">
                    {l.items.map((i, k) => (
                      <li key={k}>
                        {i.quantity} × {i.title}
                        {!i.onSale && <span className="hint"> (not on sale, left out)</span>}
                      </li>
                    ))}
                    {l.discountCode && <li>Code <span className="font-mono">{l.discountCode}</span></li>}
                  </ul>
                  <form action={deleteCartLinkAction.bind(null, l.id, l.name)}>
                    <SubmitButton className="btn btn-secondary text-sm">Delete</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
