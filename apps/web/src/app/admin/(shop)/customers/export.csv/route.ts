import { can, CUSTOMER_FILTERS, customersCsv } from "@sf/core";
import { requireShop } from "@/lib/server";

/** The customer list as a spreadsheet, with the same search, tag and filter. */
export async function GET(request: Request) {
  const { shop, db, role } = await requireShop("customers");
  const p = new URL(request.url).searchParams;
  const tag = p.get("tag") ?? undefined;
  const filter = CUSTOMER_FILTERS.find((f) => f === p.get("filter"));
  const csv = await customersCsv(db, shop.id, { query: p.get("q") ?? undefined, tag, filter, money: can(role, "money") });
  const name = [shop.handle, "customers", tag?.replace(/[^a-z0-9-]+/gi, "-"), filter].filter(Boolean).join("-");
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" },
  });
}
