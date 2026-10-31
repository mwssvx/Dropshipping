import Link from "next/link";
import { countryName, formatMoney, LANGUAGES, productFeed, reviewCounts, shopLanguages } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { CopyLink } from "./CopyLink";
import { PixelsForm } from "./PixelsForm";

export const metadata = { title: "Sales channels" };

export default async function ChannelsPage() {
  const { shop, db } = await requireShop("marketing");
  const address = await storeAddress(shop);
  const [{ items, issues }, reviews] = await Promise.all([productFeed(db, shop, { origin: address }), reviewCounts(db, shop.id)]);
  const products = new Set(items.map((i) => i.groupId)).size;
  const languages = shopLanguages(shop);
  // What Merchant Center checks first: barcodes, shipping and weight.
  const physical = items.filter((i) => !i.digital);
  const withGtin = items.filter((i) => i.gtin).length;
  const shipped = items.filter((i) => i.shipping);
  const unshipped = physical.length - shipped.length;
  const cheapest = shipped.length ? Math.min(...shipped.map((i) => i.shipping!.priceMinor)) : null;
  const noWeight = shipped.filter((i) => !i.weightGrams).length;
  // Options sent from a supplier's warehouse in another country, by country.
  const abroad = [...new Set(physical.map((i) => i.shipsFrom).filter((c): c is string => !!c && c !== shop.country))];
  const fromAbroad = physical.filter((i) => i.shipsFrom && i.shipsFrom !== shop.country).length;
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
    {
      id: "pinterest",
      name: "Pinterest",
      file: "google.xml",
      steps: "Pinterest reads the same file as Google. In your Pinterest business account, open Ads, then Catalogs, “Create data source”. Paste the link, pick XML, your currency and a daily update. Your products become shoppable Pins.",
    },
    {
      id: "tiktok",
      name: "TikTok",
      file: "google.xml",
      steps: "TikTok also reads the Google file. In TikTok Ads Manager, open Assets, then Catalogs, add products with “Data feed”, paste the link and pick a daily update. Use the catalog in video shopping ads.",
    },
  ];
  return (
    <main className="pb-12">
      <PageHeader title="Sales channels" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="hint max-w-2xl">
          List your products in Google Shopping, in Facebook and Instagram shops and ads, on Pinterest and in TikTok ads. Each channel reads a feed from your store once a day, so
          new products, prices, sales and stock follow by themselves. Gift cards aren&apos;t listed.
        </p>
        <p className="text-sm" role="status">
          <span className="font-semibold num">{products}</span> {products === 1 ? "product" : "products"} ({items.length} {items.length === 1 ? "option" : "options"}) in your feeds
          {issues.length > 0 ? `, ${issues.length} ${issues.length === 1 ? "thing" : "things"} to fix below.` : "."}
        </p>
        {items.length > 0 && (
          <section className="card p-5 flex flex-col gap-2 text-sm" aria-labelledby="feed-details-heading">
            <h2 id="feed-details-heading" className="font-semibold">What the feeds send</h2>
            <ul className="flex flex-col gap-1">
              <li>
                <span className="num font-semibold">{withGtin}</span> of <span className="num">{items.length}</span> options have a barcode (UPC or EAN), sent as their GTIN.{" "}
                {withGtin < items.length && <span className="hint">Add one on a product&apos;s options if it came with one; Google ranks listings with a GTIN higher. Your own designs don&apos;t need one.</span>}
              </li>
              <li>
                {cheapest !== null ? <>Shipping to {countryName(shop.country)}: {cheapest === 0 ? "free" : `from ${formatMoney(cheapest, shop.currency)}`}, from your shipping rates.</> : <>No shipping rate to {countryName(shop.country)} yet, so Google asks you for one.</>}{" "}
                {unshipped > 0 && cheapest !== null && <span className="hint">{unshipped} {unshipped === 1 ? "option is" : "options are"} too heavy for every rate.</span>}{" "}
                <Link href="/admin/shipping" className="underline">Shipping rates</Link>
              </li>
              {fromAbroad > 0 && (
                <li id="feed-ships-from">
                  <span className="num font-semibold">{fromAbroad}</span> {fromAbroad === 1 ? "option ships" : "options ship"} from {abroad.map(countryName).join(", ")}, and the Google feed says so (ships from country).{" "}
                  <span className="hint">Google expects longer delivery from abroad, so it&apos;s less likely to flag your delivery times.{fromAbroad < physical.length && ` The rest ship from ${countryName(shop.country)}.`}</span>
                </li>
              )}
              {noWeight > 0 && <li><span className="num font-semibold">{noWeight}</span> {noWeight === 1 ? "option has" : "options have"} no weight. <span className="hint">Google uses it to check shipping costs.</span></li>}
            </ul>
          </section>
        )}
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
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="ratings-heading">
          <h2 id="ratings-heading" className="font-semibold">Stars in Google Shopping</h2>
          <p className="hint text-sm">
            Your published reviews as Google&apos;s product review feed, so your ads and listings can show stars. Google asks for at least 50
            reviews in all before it shows any; you have <span className="num">{reviews.published}</span>.
          </p>
          <CopyLink url={`${address}/feeds/reviews.xml`} label="Google product reviews feed link" />
          <p className="hint text-sm">
            In Google Merchant Center, open Growth, then Manage programs, and turn on Product ratings. Choose to send reviews by feed, paste the
            link and pick a daily fetch. New reviews follow by themselves; ones you hide, and ones shoppers reported, stay out.
          </p>
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="pixels-heading">
          <div>
            <h2 id="pixels-heading" className="font-semibold">Ad tracking</h2>
            <p className="hint text-sm">
              Paste your pixel and tag IDs so your ads can see what they lead to. Your store tells them when someone views a product, adds to cart,
              starts checkout and buys, with the price and the same IDs as your feeds. Visitors are asked first in a cookie banner in their
              language, and nothing loads until they agree. Saying no doesn&apos;t stop anyone from shopping.
            </p>
          </div>
          <PixelsForm meta={shop.adPixels?.meta ?? ""} tiktok={shop.adPixels?.tiktok ?? ""} google={shop.adPixels?.google ?? ""} pinterest={shop.adPixels?.pinterest ?? ""} consent={shop.cookieConsent} />
        </section>
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
