import Link from "next/link";
import { can, formatMoney, RECENT_SALES_MIN, listCollections, listSavedViews, MAX_BULK_PRODUCTS, PRODUCT_PAGE_SIZE, PRODUCT_SORTS, type ProductGap, productGaps, type ProductMargin, productMargins, type ProductUnsold, productUnsold, type ProductSource, productSources, type ProductStockFilter, productPage, productTags, recentBulkEdits, runningLow, soldOutAtSupplier } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { BulkProducts, type BulkRow } from "./BulkProducts";
import { LowStockForm } from "./LowStockForm";
import { RestockAlertForm } from "./RestockAlertForm";
import { BadgeSettingsForm } from "./BadgeSettingsForm";
import { SoldOutForm } from "./SoldOutForm";
import { QuickAddForm } from "./QuickAddForm";
import { ShareButtonsForm } from "./ShareButtonsForm";
import { RecentSalesForm } from "./RecentSalesForm";
import { PriceImportForm } from "./PriceImportForm";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { SavedViews } from "@/components/SavedViews";

export const metadata = { title: "Products" };

const STATUSES = [["active", "On sale"], ["draft", "Drafts"], ["archived", "Archived"]] as const;
const STOCK: (readonly [ProductStockFilter, string])[] = [["in_stock", "In stock"], ["low", "Running low"], ["sold_out", "Sold out"]];
const SOURCES: (readonly [ProductSource, string])[] = [["supplier", "From suppliers"], ["own", "Your own stock"], ["digital", "Downloads"], ["gift_card", "Gift cards"]];
const GAPS: (readonly [ProductGap, string])[] = [["photo", "No photo"], ["description", "No description"], ["weight", "No weight"], ["customs", "No customs details"]];
const MARGINS: (readonly [ProductMargin, string])[] = [["low", "Under 20%"], ["loss", "Below cost"]];
const UNSOLD: (readonly [ProductUnsold, string])[] = [["30", "30 days"], ["90", "90 days"]];
const SORTS = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["title", "Title A to Z"],
  ["title_desc", "Title Z to A"],
  ["updated", "Recently changed"],
  ["price", "Price, low to high"],
  ["price_desc", "Price, high to low"],
] as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; tag?: string; stock?: string; source?: string; collection?: string; missing?: string; margin?: string; unsold?: string; sort?: string; page?: string }> }) {
  const { shop, db, role } = await requireShop("products");
  const params = await searchParams;
  const q = params.q?.trim() || undefined;
  const status = STATUSES.find(([s]) => s === params.status)?.[0];
  const tag = params.tag?.trim().toLowerCase().slice(0, 30) || undefined;
  const stock = STOCK.find(([s]) => s === params.stock)?.[0];
  const source = SOURCES.find(([s]) => s === params.source)?.[0];
  const missing = GAPS.find(([g]) => g === params.missing)?.[0];
  const margin = MARGINS.find(([m]) => m === params.margin)?.[0];
  const unsold = UNSOLD.find(([d]) => d === params.unsold)?.[0];
  // Only hand-picked collections: an automatic one's page already shows what its rules match.
  const collections = await listCollections(db, shop.id);
  const picked = collections.filter((c) => !c.rules);
  const collection = picked.find((c) => c.id === params.collection)?.id;
  // Newest first is the default, so it's left out of links.
  const sort = PRODUCT_SORTS.find((s) => s === params.sort && s !== "newest");
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(params.page)) || 1));
  const [{ products, total }, recent, soldOut, low, tags, sources, views, gaps, margins, unsoldCounts] = await Promise.all([
    productPage(db, shop.id, { query: q, status, tag, stock, source, collection, missing, margin, unsold, sort, page }),
    recentBulkEdits(db, shop.id),
    soldOutAtSupplier(db, shop.id),
    runningLow(db, shop.id),
    productTags(db, shop.id),
    productSources(db, shop.id),
    listSavedViews(db, shop.id, "products"),
    productGaps(db, shop.id),
    productMargins(db, shop.id),
    productUnsold(db, shop.id),
  ]);
  const filtered = !!(q || status || tag || stock || source || collection || missing || margin || unsold);
  // Only what some product still lacks, so a finished catalog shows no Missing row.
  const shownGaps = GAPS.filter(([g]) => gaps[g] > 0 || missing === g);
  const shownMargins = MARGINS.filter(([m]) => margins[m] > 0 || margin === m);
  const shownUnsold = UNSOLD.filter(([d]) => unsoldCounts[d] > 0 || unsold === d);
  // The source filter only shows when the store has products from more than one place.
  const shownSources = SOURCES.filter(([s]) => sources[s] > 0 || source === s);
  const pages = Math.ceil(total / PRODUCT_PAGE_SIZE);
  // Keeps the other filters when one changes; a new filter starts at page 1.
  const href = (next: { q?: string; status?: string; tag?: string; stock?: string; source?: string; collection?: string; missing?: string; margin?: string; unsold?: string; page?: number }) => {
    const merged = { q, status, tag, stock, source, collection, missing, margin, unsold, sort, ...next, page: next.page && next.page > 1 ? String(next.page) : undefined };
    const out = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => !!e[1]));
    return out.size ? `/admin/products?${out}` : "/admin/products";
  };
  const first = (page - 1) * PRODUCT_PAGE_SIZE + 1;
  const rows: BulkRow[] = products.map((p) => {
    const v = p.variants[0];
    return {
      id: p.id,
      title: p.title,
      imageUrl: p.imageUrl,
      status: p.status,
      scheduled: p.status === "draft" && !!p.publishAt,
      price: v ? formatMoney(v.priceMinor, shop.currency) : "—",
      margin: v?.costMinor != null && v.priceMinor > 0 ? Math.round(((v.priceMinor - v.costMinor) / v.priceMinor) * 100) : null,
    };
  });
  const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  return (
    <main className="pb-12">
      <PageHeader title="Products" actions={<>
        <Link href="/admin/products/new" className="btn btn-secondary">Add by hand</Link>
        <Link href="/admin/products/import" className="btn btn-primary">Import from supplier</Link>
      </>} />
      <div className="px-4 sm:px-8">
        {soldOut.length > 0 && (
          <section id="supplier-sold-out" className="card p-5 mb-6 flex flex-col gap-3 max-w-3xl scroll-mt-20" aria-labelledby="supplier-sold-out-heading">
            <div>
              <h2 id="supplier-sold-out-heading" className="font-semibold">Sold out at the supplier</h2>
              <p className="hint text-sm">
                Every option of {soldOut.length === 1 ? "this product" : "these products"} ran out at the supplier, so buyers can&apos;t order{" "}
                {soldOut.length === 1 ? "it" : "them"}. Add a backup supplier on the product page and orders go there instead, or take{" "}
                {soldOut.length === 1 ? "it" : "them"} off sale. The store sells {soldOut.length === 1 ? "it" : "them"} again by itself when the supplier restocks.
              </p>
            </div>
            <ul className="flex flex-col divide-y divide-border" aria-label="Sold out at the supplier">
              {soldOut.map((p) => (
                <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                  <Link href={`/admin/products/${p.id}`} className="underline">{p.title}</Link>
                  <span className="hint text-sm">{p.hasBackup ? "Backup supplier is out too" : "No backup supplier"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {low.length > 0 && (
          <section id="running-low" className="card p-5 mb-6 flex flex-col gap-3 max-w-3xl scroll-mt-20" aria-labelledby="running-low-heading">
            <div>
              <h2 id="running-low-heading" className="font-semibold">Running low</h2>
              <p className="hint text-sm">Your own stock with {shop.restockAlertAt} or fewer left. Enter the new count on the product page when you restock.</p>
            </div>
            <ul className="flex flex-col divide-y divide-border" aria-label="Running low">
              {low.slice(0, 50).map((r) => (
                <li key={r.variantId} className="py-2 flex items-center justify-between gap-3">
                  <Link href={`/admin/products/${r.productId}`} className="underline">{r.title}</Link>
                  <span className={`text-sm num ${r.stock === 0 ? "text-critical font-semibold" : "hint"}`}>{r.stock === 0 ? "Sold out" : `${r.stock} left`}</span>
                </li>
              ))}
            </ul>
            {low.length > 50 && <p className="hint text-sm">And {low.length - 50} more.</p>}
          </section>
        )}
        {(total > 0 || filtered || page > 1 || views.length > 0) && (
          <div className="flex flex-col gap-3 mb-4">
            <form className="flex flex-wrap gap-2 max-w-2xl" role="search">
              <label className="sr-only" htmlFor="product-q">Search products</label>
              <input className="input flex-1 min-w-40" id="product-q" name="q" type="search" defaultValue={q} placeholder="Title or SKU" />
              {status && <input type="hidden" name="status" value={status} />}
              {tag && <input type="hidden" name="tag" value={tag} />}
              {stock && <input type="hidden" name="stock" value={stock} />}
              {source && <input type="hidden" name="source" value={source} />}
              {missing && <input type="hidden" name="missing" value={missing} />}
              {margin && <input type="hidden" name="margin" value={margin} />}
              {unsold && <input type="hidden" name="unsold" value={unsold} />}
              <button className="btn btn-secondary">Search</button>
              {picked.length > 0 && (
                <AutoSubmitSelect id="product-collection" name="collection" label="In collection" value={collection ?? ""}
                  options={[["", "Every collection"], ...picked.map((c) => [c.id, `${c.title} (${c.productCount.toLocaleString("en-US")})`] as const)]} />
              )}
              <AutoSubmitSelect id="product-sort" label="Sort products" value={sort ?? "newest"} options={SORTS} />
            </form>
            <SavedViews list="products" views={views} params={{ q, status, tag, stock, source, collection, missing, margin, unsold, sort }} />
            <nav className="flex flex-wrap gap-1" aria-label="Product filters">
              <Link href={href({ status: undefined })} className={`chip text-sm ${!status ? "font-semibold border-accent" : ""}`} aria-current={!status ? "page" : undefined}>All</Link>
              {STATUSES.map(([s, label]) => (
                <Link key={s} href={href({ status: s })} className={`chip text-sm ${status === s ? "font-semibold border-accent" : ""}`} aria-current={status === s ? "page" : undefined}>{label}</Link>
              ))}
            </nav>
            <nav className="flex flex-wrap gap-1 items-center" aria-label="Filter by stock">
              <span className="hint text-sm mr-1">Stock</span>
              {/* Running low follows the running-low email's number, so it's left out when that's off. */}
              {STOCK.filter(([s]) => s !== "low" || shop.restockAlertAt > 0 || stock === "low").map(([s, label]) => (
                <Link key={s} href={href({ stock: stock === s ? undefined : s })} className={`chip text-sm ${stock === s ? "font-semibold border-accent" : ""}`} aria-current={stock === s ? "page" : undefined}>{label}</Link>
              ))}
            </nav>
            {shownSources.length > 1 && (
              <nav className="flex flex-wrap gap-1 items-center" aria-label="Filter by source">
                <span className="hint text-sm mr-1">Source</span>
                {shownSources.map(([s, label]) => (
                  <Link key={s} href={href({ source: source === s ? undefined : s })} className={`chip text-sm ${source === s ? "font-semibold border-accent" : ""}`} aria-current={source === s ? "page" : undefined}>
                    {label} <span className="hint num">{sources[s]}</span>
                  </Link>
                ))}
              </nav>
            )}
            {shownGaps.length > 0 && (
              <nav className="flex flex-wrap gap-1 items-center" aria-label="Filter by what's missing">
                <span className="hint text-sm mr-1">Missing</span>
                {shownGaps.map(([g, label]) => (
                  <Link key={g} href={href({ missing: missing === g ? undefined : g })} className={`chip text-sm ${missing === g ? "font-semibold border-accent" : ""}`} aria-current={missing === g ? "page" : undefined}>
                    {label} <span className="hint num">{gaps[g]}</span>
                  </Link>
                ))}
              </nav>
            )}
            {shownMargins.length > 0 && (
              <nav className="flex flex-wrap gap-1 items-center" aria-label="Filter by margin">
                <span className="hint text-sm mr-1">Margin</span>
                {shownMargins.map(([m, label]) => (
                  <Link key={m} href={href({ margin: margin === m ? undefined : m })} className={`chip text-sm ${margin === m ? "font-semibold border-accent" : ""}`} aria-current={margin === m ? "page" : undefined}>
                    {label} <span className="hint num">{margins[m]}</span>
                  </Link>
                ))}
              </nav>
            )}
            {shownUnsold.length > 0 && (
              <nav className="flex flex-wrap gap-1 items-center" aria-label="Filter by not sold">
                <span className="hint text-sm mr-1">Not sold in</span>
                {shownUnsold.map(([d, label]) => (
                  <Link key={d} href={href({ unsold: unsold === d ? undefined : d })} className={`chip text-sm ${unsold === d ? "font-semibold border-accent" : ""}`} aria-current={unsold === d ? "page" : undefined}>
                    {label} <span className="hint num">{unsoldCounts[d]}</span>
                  </Link>
                ))}
              </nav>
            )}
            {unsold && <p className="hint text-sm">Products on sale for more than {unsold} days with no paid order in that time. Try a sale, a better photo or description, or archive them to keep the store tidy.</p>}
            {margin && <p className="hint text-sm">Products with an option that keeps {margin === "loss" ? "less than nothing: it sells for less than it costs" : "under 20% of its price after its cost"}. Options with no cost entered aren&apos;t counted. Fees and shipping aren&apos;t taken off.</p>}
            {missing === "weight" && <p className="hint text-sm">Products that ship with an option that has no weight. Shipping rates by weight can&apos;t price those options.</p>}
            {missing === "customs" && <p className="hint text-sm">Products that ship with no HS code or no country it was made in. Customs can hold a parcel that crosses a border without them.</p>}
            {stock === "low" && <p className="hint text-sm">Still for sale, with an option at {shop.restockAlertAt} or fewer left. Change the number under Running-low email below.</p>}
            {tags.length > 0 && (
              <nav className="flex flex-wrap gap-1 items-center" aria-label="Filter by tag">
                <span className="hint text-sm mr-1">Tags</span>
                {tags.slice(0, 30).map((t) => (
                  <Link key={t.tag} href={href({ tag: tag === t.tag ? undefined : t.tag })} className={`chip text-sm ${tag === t.tag ? "font-semibold border-accent" : ""}`} aria-current={tag === t.tag ? "page" : undefined}>
                    {t.tag} <span className="hint num">{t.count}</span>
                  </Link>
                ))}
              </nav>
            )}
            {can(role, "export") && (
              <p className="text-sm">
                <a className="underline" href={`/admin/export/products.csv${filtered ? `?${new URLSearchParams(Object.entries({ q, status, tag, stock, source, collection, missing, margin, unsold }).filter((e): e is [string, string] => !!e[1]))}` : ""}`} download>
                  Download {filtered ? "these products" : "all products"} as a spreadsheet
                </a>
              </p>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer underline w-fit">Change prices and stock from a spreadsheet</summary>
              <PriceImportForm canDownload={can(role, "export")} />
            </details>
          </div>
        )}
        {products.length === 0 && (filtered || page > 1) ? (
          <div className="card p-10 text-center hint">
            {page > 1 && !filtered ? "There are no more products." : q ? `No products match "${q}".` : "No products here."}{" "}
            <Link href="/admin/products" className="underline">See all products</Link>
          </div>
        ) : products.length === 0 ? (
          <div className="card p-10 flex flex-col items-center text-center gap-3">
            <h2 className="font-semibold text-lg">Add your first product</h2>
            <p className="hint max-w-sm">Paste a product link from your supplier and we fill in the title, options and costs. Orders for it go to the supplier automatically.</p>
            <div className="flex gap-2 flex-wrap justify-center">
              <Link href="/admin/products/import" className="btn btn-primary">Import from supplier</Link>
              <Link href="/admin/products/new" className="btn btn-secondary">Add by hand</Link>
            </div>
            <Link href="/admin/products/move" className="text-sm underline">Moving from Shopify? Bring your products over</Link>
          </div>
        ) : (
          <BulkProducts
            rows={rows}
            collections={collections.filter((c) => !c.rules).map((c) => ({ id: c.id, title: c.title }))}
            tags={tags.map((t) => t.tag)}
            recent={recent.map((r) => ({ id: r.id, summary: r.summary, when: when(r.createdAt), undone: !!r.undoneAt, canUndo: r.canUndo }))}
            total={total}
            list={Object.fromEntries(Object.entries({ q, status, tag, stock, source, collection, missing, margin, unsold }).filter((e): e is [string, string] => !!e[1]))}
            maxAll={MAX_BULK_PRODUCTS}
          />
        )}
        {pages > 1 && products.length > 0 && (
          <nav aria-label="Pages" className="flex items-center gap-3 text-sm mt-4">
            {page > 1 && <Link href={href({ page: page - 1 })} className="btn btn-secondary">← Previous</Link>}
            <span className="hint num">{first.toLocaleString("en-US")} to {(first + products.length - 1).toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>
            {page < pages && <Link href={href({ page: page + 1 })} className="btn btn-secondary ml-auto">Next →</Link>}
          </nav>
        )}
        {total > 0 && (
          <p className="mt-4 text-sm"><Link href="/admin/products/move" className="underline">Move products from Shopify</Link></p>
        )}
        <section className="card p-5 mt-6 flex flex-col gap-3 max-w-3xl" aria-labelledby="low-stock-heading">
          <div>
            <h2 id="low-stock-heading" className="font-semibold">Few left</h2>
            <p className="hint">
              Product pages say "Only 3 left" when an option is running low, so buyers know to order soon. The number is always the real stock
              from your supplier or what you entered, never made up, and nothing shows for options without a stock count.
            </p>
          </div>
          <LowStockForm value={shop.lowStockNote} />
        </section>
        <section className="card p-5 mt-6 flex flex-col gap-3 max-w-3xl" aria-labelledby="restock-alert-heading">
          <div>
            <h2 id="restock-alert-heading" className="font-semibold">Running-low email</h2>
            <p className="hint">
              For products you added yourself, whose stock goes down as they sell. When an option gets down to this many, everyone who looks after
              products gets one email, and it shows under Running low at the top of this page. Imported products follow the supplier instead.
            </p>
          </div>
          <RestockAlertForm value={shop.restockAlertAt} />
        </section>
        <section className="card p-5 mt-6 flex flex-col gap-3 max-w-3xl" aria-labelledby="badges-heading">
          <div>
            <h2 id="badges-heading" className="font-semibold">Badges</h2>
            <p className="hint">
              Small labels on product cards across your store. These are worked out from your real prices, stock and dates, so they&apos;re never wrong.
              You can also give any product a badge of its own, like “Bestseller”, on its page here.
            </p>
          </div>
          <BadgeSettingsForm sale={shop.productBadges.sale} soldOut={shop.productBadges.soldOut} newDays={shop.productBadges.newDays} />
        </section>
        <section className="card p-5 mt-6 flex flex-col gap-3 max-w-3xl" aria-labelledby="sold-out-heading">
          <div>
            <h2 id="sold-out-heading" className="font-semibold">Sold-out products</h2>
            <p className="hint">
              Where products nobody can order right now go in collections, search and on your home page. Products open for pre-order count as
              available. A hidden product&apos;s own page still works, so links people saved keep working and buyers can ask to hear when it&apos;s back.
            </p>
          </div>
          <SoldOutForm value={shop.soldOutProducts} />
        </section>
        <section className="card p-5 mt-6 flex flex-col gap-3 max-w-3xl" aria-labelledby="quick-add-heading">
          <div>
            <h2 id="quick-add-heading" className="font-semibold">Add to cart from product cards</h2>
            <p className="hint">
              Shoppers can add a product straight from collections, search and your home page, without opening its page. Only products with
              nothing to choose get the button: one option, nothing to type, and in stock. The rest still open their page.
            </p>
          </div>
          <QuickAddForm on={shop.cardQuickAdd} />
        </section>
        <section className="card p-5 mt-6 flex flex-col gap-3 max-w-3xl" aria-labelledby="share-heading">
          <div>
            <h2 id="share-heading" className="font-semibold">Share buttons</h2>
            <p className="hint">
              Product pages get buttons to copy the link or share it on WhatsApp, Facebook and Pinterest. On phones, Share opens the phone&apos;s own list of apps.
              Shared links show the product&apos;s photo and title.
            </p>
          </div>
          <ShareButtonsForm on={shop.shareButtons} />
        </section>
        <section className="card p-5 mt-6 flex flex-col gap-3 max-w-3xl" aria-labelledby="recent-sales-heading">
          <div>
            <h2 id="recent-sales-heading" className="font-semibold">Recent sales</h2>
            <p className="hint">
              Product pages say &quot;12 sold in the last 7 days&quot;, counted from paid orders and leaving out refunds, so it&apos;s always true.
              It only shows once a product has sold {RECENT_SALES_MIN} or more that week.
            </p>
          </div>
          <RecentSalesForm on={shop.recentSales} />
        </section>
      </div>
    </main>
  );
}
