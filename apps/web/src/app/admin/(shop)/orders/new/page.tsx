import Link from "next/link";
import { countryName, formatMoney, listActiveProducts, listShippingZones, shipsTo } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { PaymentLinkForm } from "./PaymentLinkForm";

export const metadata = { title: "Payment link" };

export default async function NewPaymentLinkPage() {
  const { shop, db } = await requireShop("orders");
  const [products, { zones }] = await Promise.all([listActiveProducts(db, shop.id), listShippingZones(db, shop.id)]);
  const variants = products
    .filter((p) => !p.giftCard)
    .flatMap((p) => p.variants.map((x) => ({ id: x.id, label: `${p.title}${x.title === "Default" ? "" : ` – ${x.title}`} · ${formatMoney(x.priceMinor, shop.currency)}` })));
  const countries = shipsTo(zones).map((c) => [c, countryName(c)] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <main className="pb-12">
      <PageHeader title="Create a payment link" back={<Link href="/admin/orders" className="hint hover:text-ink">← Orders</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        <p className="hint max-w-2xl">For a customer who asked by message, phone or in person: build their order here and we email them a link to pay by card.</p>
        {variants.length === 0 ? (
          <p className="card p-6 hint">Put a product on sale first.</p>
        ) : (
          <PaymentLinkForm variants={variants} countries={countries} defaultCountry={countries.some(([c]) => c === shop.country) ? shop.country : (countries[0]?.[0] ?? "US")} />
        )}
      </div>
    </main>
  );
}
