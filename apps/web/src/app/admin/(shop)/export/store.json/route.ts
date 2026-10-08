import { exportStore } from "@sf/core";
import { requireShop } from "@/lib/server";

/** Everything that makes up the store, as one file that loads into a new store. */
export async function GET() {
  const { shop, db } = await requireShop("export");
  const file = await exportStore(db, shop.id);
  const name = `${shop.handle}-store-${file.exported_at.slice(0, 10)}.json`;
  return new Response(JSON.stringify(file, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
