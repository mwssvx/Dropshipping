import Link from "next/link";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { ShopifyImportForm } from "./ShopifyImportForm";
import { ShopifyCustomersForm } from "./ShopifyCustomersForm";

export const metadata = { title: "Move from Shopify" };

export default async function MoveFromShopifyPage() {
  await requireShop("products");
  return (
    <main className="pb-12">
      <PageHeader title="Move from Shopify" back={<Link href="/admin/products" className="hint hover:text-ink">← Products</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <section className="flex flex-col gap-2" aria-labelledby="how-heading">
          <h2 id="how-heading" className="font-semibold">Bring your products over</h2>
          <ol className="list-decimal pl-5 text-sm flex flex-col gap-1">
            <li>In Shopify, open Products and click Export.</li>
            <li>Pick &quot;All products&quot; and &quot;CSV for Excel, Numbers, or other spreadsheet programs&quot;, then Export products. Shopify emails you the file.</li>
            <li>Choose that file below.</li>
          </ol>
          <p className="hint text-sm">
            Titles, descriptions, options, prices, compare-at prices, costs, stock, SKUs, photos and search listings come across. Each product keeps
            its web address (/products/…), so links and search results keep working once your domain points here. Products already in your store
            are left alone, so you can add the same file again safely.
          </p>
          <p className="hint text-sm">
            Shopify apps don&apos;t come across. Link each product to a supplier from its page so orders are sent automatically.
          </p>
        </section>
        <ShopifyImportForm />
        <section className="flex flex-col gap-2" aria-labelledby="customers-heading">
          <h2 id="customers-heading" className="font-semibold">Bring your customers over</h2>
          <p className="hint text-sm">
            In Shopify, open Customers, click Export and pick &quot;All customers&quot; as a CSV file. Names, notes and tags come across, and
            customers who agreed to marketing email on Shopify can get your campaigns here. Nobody is subscribed who didn&apos;t agree, and
            anyone who unsubscribed here stays unsubscribed. Past Shopify orders don&apos;t come across.
          </p>
        </section>
        <ShopifyCustomersForm />
      </div>
    </main>
  );
}
