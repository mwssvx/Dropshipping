import { trackingTemplateCsv } from "@sf/core";
import { requireShop } from "@/lib/server";

/** Paid orders waiting for tracking, with empty Carrier and Tracking number columns to fill in. */
export async function GET() {
  const { shop, db } = await requireShop("orders");
  const csv = await trackingTemplateCsv(db, shop.id);
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${shop.handle}-tracking.csv"`, "cache-control": "no-store" },
  });
}
