import Link from "next/link";
import { countryName, DEMO_SUPPLIER_LINKS, formatMoney, previewImport, UserError, type ImportPreview } from "@sf/core";
import { requireShop, suppliers } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { ImportForm } from "./ImportForm";

export const metadata = { title: "Import from supplier" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ url?: string; warehouse?: string }> }) {
  const { url, warehouse } = await searchParams;
  const { shop, db } = await requireShop("products");
  const available = suppliers().available;
  let preview: ImportPreview | null = null;
  let error: string | null = null;
  if (url) {
    try {
      preview = await previewImport(db, suppliers(), shop.id, url, warehouse);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      error = e.message;
    }
  }
  const demo = available.some((s) => s.name === "fake");
  const notConnected = [
    ["cj", "CJ Dropshipping"],
    ["aliexpress", "AliExpress"],
  ].filter(([name]) => !available.some((s) => s.name === name)).map(([, label]) => label);

  return (
    <main className="pb-12">
      <PageHeader title="Import from supplier" back={<Link href="/admin/products" className="hint hover:text-ink">← Products</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <form method="get" className="card p-5 flex flex-col gap-3">
          <label className="label" htmlFor="url">Product link</label>
          <div className="flex gap-2 flex-col sm:flex-row">
            <input className="input" id="url" name="url" type="url" required defaultValue={url} placeholder="https://www.aliexpress.com/item/…" />
            <button className="btn btn-primary shrink-0">Look up</button>
          </div>
          <p className="hint">
            Paste a product page from {available.filter((s) => s.name !== "fake").map((s) => s.label).join(", ") || "your supplier"}.
            {notConnected.length > 0 && ` ${notConnected.join(" and ")} links work once ${notConnected.length > 1 ? "they're" : "it's"} connected.`}
          </p>
          {demo && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="hint">Try a demo product:</span>
              {DEMO_SUPPLIER_LINKS.map((l) => (
                <Link key={l} href={`?url=${encodeURIComponent(l)}`} className="chip text-sm">{l.split("/").at(-1)!.replace(/-/g, " ")}</Link>
              ))}
            </div>
          )}
        </form>

        {error && <p role="alert" className="banner banner-critical">{error}</p>}

        {preview && (
          <>
            {preview.alreadyImported && (
              <p className="banner banner-info">
                You already imported this as <Link className="underline" href={`/admin/products/${preview.alreadyImported.id}`}>{preview.alreadyImported.title}</Link>.
              </p>
            )}
            {preview.warehouses.length > 1 && (
              <section className="card p-5 flex flex-col gap-3" aria-labelledby="warehouse-heading">
                <div>
                  <h2 id="warehouse-heading" className="font-semibold">Pick a warehouse</h2>
                  <p className="hint">
                    The supplier sends this from {preview.warehouses.length} warehouses, each with its own cost and delivery time. Your store sells from one, so buyers
                    don&apos;t see a &quot;Ships from&quot; choice. A warehouse in {countryName(shop.country)} is faster and has no customs.
                  </p>
                </div>
                <ul className="flex flex-wrap gap-2" aria-label="Warehouses">
                  {preview.warehouses.map((w) => {
                    const on = w.name === preview!.warehouse;
                    return (
                      <li key={w.name}>
                        <Link
                          aria-current={on ? "true" : undefined}
                          href={`?url=${encodeURIComponent(url!)}&warehouse=${encodeURIComponent(w.name)}`}
                          className={`chip text-sm ${on ? "border-[var(--color-accent)] shadow-[inset_0_0_0_1px_var(--color-accent)] font-medium" : ""}`}
                        >
                          {w.name} · from {formatMoney(w.lowestCostMinor, shop.currency)}{w.fastestDays !== null ? ` · up to ${w.fastestDays} days` : ""}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {preview.shipsFrom && (
                  <p className="text-sm" role="note">
                    It&apos;ll show &quot;Ships from {countryName(preview.shipsFrom)}&quot; on the product page, and buyers in {countryName(shop.country)} get the import duties note if you&apos;ve turned it on.
                  </p>
                )}
              </section>
            )}
            <ImportForm key={`${preview.product.ref}-${preview.warehouse ?? ""}`} url={url!} preview={preview} currency={shop.currency} />
          </>
        )}
      </div>
    </main>
  );
}
