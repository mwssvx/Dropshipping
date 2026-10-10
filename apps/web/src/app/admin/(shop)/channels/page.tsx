import Link from "next/link";
import { LANGUAGES, productFeed, shopLanguages } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { CopyLink } from "./CopyLink";

export const metadata = { title: "Sales channels" };

export default async function ChannelsPage() {
  const { shop, db } = await requireShop("marketing");
  const address = await storeAddress(shop);
  const { items, issues } = await productFeed(db, shop, { origin: address });
  const products = new Set(items.map((i) => i.groupId)).size;
  const languages = shopLanguages(shop);
  const feeds = [
    {
      id: "google",
      name: "Google Shopping",
      file: "google.xml",
      steps: "In Google Merchant Center, open Products, then Add products, choose “Add products from a file” and “Add a link to your file”. Paste the link and pick a daily fetch.",
    },
    {
      id: "meta",
      name: "Facebook and Instagram",
      file: "meta.csv",
      steps: "In Meta Commerce Manager, open your catalog, then Data sources, Data feed, “Scheduled feed”. Paste the link and pick a daily update.",
    },
  ];
  return (
    <main className="pb-12">
      <PageHeader title="Sales channels" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="hint max-w-2xl">
          List your products in Google Shopping and in Facebook and Instagram shops and ads. Each channel reads a feed from your store once a day, so
          new products, prices, sales and stock follow by themselves. Gift cards aren&apos;t listed.
        </p>
        <p className="text-sm" role="status">
          <span className="font-semibold num">{products}</span> {products === 1 ? "product" : "products"} ({items.length} {items.length === 1 ? "option" : "options"}) in your feeds
          {issues.length > 0 ? `, ${issues.length} ${issues.length === 1 ? "thing" : "things"} to fix below.` : "."}
        </p>
        {feeds.map((f) => (
          <section key={f.id} className="card p-5 flex flex-col gap-3" aria-labelledby={`${f.id}-heading`}>
            <h2 id={`${f.id}-heading`} className="font-semibold">{f.name}</h2>
            <CopyLink url={`${address}/feeds/${f.file}`} label={`${f.name} feed link`} />
            {languages.map((l) => (
              <CopyLink key={l} url={`${address}/feeds/${f.file}?lang=${l}`} label={`${f.name} feed link in ${LANGUAGES[l].english}`} />
            ))}
            {languages.length > 0 && <p className="hint text-sm">One link per language, for ads in that country. Titles and links follow the language.</p>}
            <p className="hint text-sm">{f.steps}</p>
          </section>
        ))}
        <section className="card overflow-hidden" aria-labelledby="issues-heading">
          <h2 id="issues-heading" className="font-semibold px-5 pt-4 pb-2">To fix</h2>
          {issues.length === 0 ? (
            <p className="hint px-5 pb-4">Nothing. Every product on your store is in the feeds.</p>
          ) : (
            <ul className="divide-y divide-border">
              {issues.map((i, n) => (
                <li key={`${i.productId}-${n}`} className="px-5 py-3 text-sm flex flex-wrap justify-between gap-2">
                  <span><Link href={`/admin/products/${i.productId}`} className="underline">{i.title}</Link>: {i.problem}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
