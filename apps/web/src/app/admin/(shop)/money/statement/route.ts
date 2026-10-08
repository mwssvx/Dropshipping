import { statementCsv } from "@sf/core";
import { requireShop } from "@/lib/server";

/** CSV of sales, refunds and payouts. ?from=YYYY-MM-DD&to=YYYY-MM-DD, default the last 30 days. */
export async function GET(request: Request) {
  const { shop, db } = await requireShop("money");
  const q = new URL(request.url).searchParams;
  const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);
  const to = day(q.get("to")) ?? new Date();
  const from = day(q.get("from")) ?? new Date(to.getTime() - 30 * 86_400_000);
  const end = new Date(to.getTime() + 86_400_000 - 1);
  const csv = await statementCsv(db, shop, { from, to: q.get("to") ? end : to });
  const name = `${shop.handle}-statement-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
