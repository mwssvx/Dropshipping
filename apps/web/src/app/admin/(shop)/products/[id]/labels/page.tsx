import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney, getProduct, MAX_LABELS, NotFoundError } from "@sf/core";
import { requireShop } from "@/lib/server";
import { Barcode } from "@/components/Barcode";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Labels" };

/** Barcode labels for a product's options, to stick on the shelf or the items themselves. */
export default async function LabelsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const { shop, db } = await requireShop("products");
  const product = await getProduct(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const asked = Object.keys(query).some((k) => k.startsWith("n."));
  const rows = product.variants.map((v) => {
    const raw = Number(query[`n.${v.id}`]);
    // How many to print: what was asked for, or what's on the shelf, or one.
    const count = asked ? (Number.isInteger(raw) && raw > 0 ? Math.min(raw, MAX_LABELS) : 0) : Math.min(Math.max(v.stock ?? 1, 1), MAX_LABELS);
    return { v, code: v.barcode ?? v.sku, count, title: v.title === "Default" ? null : v.title };
  });
  const labels = rows.flatMap((r) => (r.code ? Array.from({ length: r.count }, (_, k) => ({ ...r, key: `${r.v.id}-${k}` })) : []));
  const total = labels.length;
  const noCode = rows.filter((r) => !r.code);
  return (
    <main className="px-4 sm:px-8 py-6 pb-12 flex flex-col gap-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <Link href={`/admin/products/${product.id}`} className="hint hover:text-ink">← {product.title}</Link>
        {total > 0 && <PrintButton>{`Print ${total} ${total === 1 ? "label" : "labels"}`}</PrintButton>}
      </div>
      <h1 className="text-xl font-semibold">Labels for {product.title}</h1>
      {noCode.length > 0 && (
        <p className="banner banner-warning" role="note">
          {noCode.map((r) => r.title ?? product.title).join(", ")} {noCode.length === 1 ? "has" : "have"} no barcode or SKU yet, so there&apos;s nothing to print. Add one on the product page.
        </p>
      )}
      <form className="card p-5 flex flex-col gap-3" aria-label="How many labels">
        <p className="hint">How many of each to print. It starts at what&apos;s on the shelf.</p>
        <div className="flex flex-wrap gap-3 items-end">
          {rows.filter((r) => r.code).map((r) => (
            <div key={r.v.id} className="field w-40">
              <label className="label" htmlFor={`n-${r.v.id}`}>{r.title ?? "Number of labels"}</label>
              <input className="input num" id={`n-${r.v.id}`} name={`n.${r.v.id}`} type="number" min={0} max={MAX_LABELS} defaultValue={r.count} />
            </div>
          ))}
          <button type="submit" className="btn btn-secondary">Update</button>
        </div>
      </form>
      <div className="print-sheets flex flex-col">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 print-labels" aria-label="Labels" role="list">
          {labels.map((l) => (
            <div key={l.key} role="listitem" className="border border-border rounded-md p-3 flex flex-col gap-1 bg-white text-black break-inside-avoid">
              <p className="text-sm font-semibold leading-tight line-clamp-2">{product.title}</p>
              {l.title && <p className="text-xs">{l.title}</p>}
              <p className="text-sm num">{formatMoney(l.v.priceMinor, shop.currency)}</p>
              <Barcode code={l.code!} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
