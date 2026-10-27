import { inventoryCsv } from "@sf/core";
import { requireShop } from "@/lib/server";

/** The inventory page as a spreadsheet. */
export async function GET() {
  const { shop, db } = await requireShop("products");
  const csv = await inventoryCsv(db, shop);
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${shop.handle}-inventory.csv"`, "cache-control": "no-store" },
  });
}
