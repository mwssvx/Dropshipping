import Link from "next/link";
import { DEMO_SUPPLIER_LINKS, previewImport, UserError, type ImportPreview } from "@sf/core";
import { requireShop, suppliers } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { ImportForm } from "./ImportForm";

export const metadata = { title: "Import from supplier" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  const { url } = await searchParams;
  const { shop, db } = await requireShop("products");
  const available = suppliers().available;
  let preview: ImportPreview | null = null;
  let error: string | null = null;
  if (url) {
    try {
      preview = await previewImport(db, suppliers(), shop.id, url);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      error = e.message;
    }
  }
  const demo = available.some((s) => s.name === "fake");

  return (
    <main className="pb-12">
      <PageHeader title="Import from supplier" back={<Link href="/admin/products" className="hint hover:text-ink">← Products</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <form method="get" className="card p-5 flex flex-col gap-3">
          <label className="label" htmlFor="url">Product link</label>
          <div className="flex gap-2 flex-col sm:flex-row">
            <input className="input" id="url" name="url" type="url" required defaultValue={url} placeholder="https://cjdropshipping.com/product/…" />
            <button className="btn btn-primary shrink-0">Look up</button>
          </div>
          <p className="hint">
            Paste a product page from {available.filter((s) => s.name !== "fake").map((s) => s.label).join(", ") || "your supplier"}.
            {!available.some((s) => s.name === "cj") && " CJ Dropshipping links work once CJ is connected."}
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
            <ImportForm key={preview.product.ref} url={url!} preview={preview} currency={shop.currency} />
          </>
        )}
      </div>
    </main>
  );
}
