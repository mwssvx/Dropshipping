import { ordersCsv } from "@sf/core";
import { requireShop } from "@/lib/server";

const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? new Date(`${s}T00:00:00Z`) : undefined);

/** The order list as a spreadsheet, with the same filters, and an optional range of days (UTC). */
export async function GET(request: Request) {
  const { shop, db } = await requireShop("orders");
  const p = new URL(request.url).searchParams;
  const from = day(p.get("from"));
  const until = day(p.get("to"));
  const to = until ? new Date(until.getTime() + 86_400_000) : undefined;
  const show = p.get("show");
  const csv = await ordersCsv(db, shop.id, {
    ...(show === "problems" ? { fulfillmentStatus: "problem" as const } : show === "held" ? { held: true } : {}),
    query: p.get("q") ?? undefined,
    tag: p.get("tag") ?? undefined,
    productId: p.get("product") ?? undefined,
    country: p.get("country") ?? undefined,
    from,
    to,
  });
  const name = [shop.handle, "orders", p.get("from"), p.get("to")].filter(Boolean).join("-");
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" },
  });
}
