import { parseProductQuery, productsCsv } from "@sf/core";
import { requireShop } from "@/lib/server";

// The product list links here with its search and filters, so a download can be just those products.
export async function GET(request: Request) {
  const { shop, db } = await requireShop("export");
  const params = new URL(request.url).searchParams;
  return new Response(await productsCsv(db, shop.id, parseProductQuery((k) => params.get(k))), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${shop.handle}-products.csv"`, "cache-control": "no-store" },
  });
}
