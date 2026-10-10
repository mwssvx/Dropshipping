import { invoicesCsv } from "@sf/core";
import { requireShop } from "@/lib/server";

/** Every invoice and credit note issued in a date range. ?from=YYYY-MM-DD&to=YYYY-MM-DD, default the last 30 days. */
export async function GET(request: Request) {
  const { shop, db } = await requireShop("taxes");
  const q = new URL(request.url).searchParams;
  const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);
  const to = day(q.get("to")) ?? new Date();
  const from = day(q.get("from")) ?? new Date(to.getTime() - 30 * 86_400_000);
  const csv = await invoicesCsv(db, shop, { from, to: q.get("to") ? new Date(to.getTime() + 86_400_000 - 1) : to });
  const name = `${shop.handle}-invoices-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
