import { productsCsv } from "@sf/core";
import { requireShop } from "@/lib/server";

export async function GET() {
  const { shop, db } = await requireShop();
  return new Response(await productsCsv(db, shop.id), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${shop.handle}-products.csv"`, "cache-control": "no-store" },
  });
}
