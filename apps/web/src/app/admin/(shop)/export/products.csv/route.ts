import { PRODUCT_STOCK_FILTERS, productsCsv } from "@sf/core";
import { requireShop } from "@/lib/server";

const STATUSES = ["active", "draft", "archived"] as const;

// The product list links here with its search and filters, so a download can be just those products.
export async function GET(request: Request) {
  const { shop, db } = await requireShop("export");
  const params = new URL(request.url).searchParams;
  const list = {
    query: params.get("q")?.trim() || undefined,
    status: STATUSES.find((s) => s === params.get("status")),
    tag: params.get("tag")?.trim().toLowerCase().slice(0, 30) || undefined,
    stock: PRODUCT_STOCK_FILTERS.find((s) => s === params.get("stock")),
  };
  return new Response(await productsCsv(db, shop.id, list), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${shop.handle}-products.csv"`, "cache-control": "no-store" },
  });
}
