import { codeBatchCsv, NotFoundError } from "@sf/core";
import { requireShop } from "@/lib/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A batch of one-time codes as a spreadsheet, to print or hand out. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { shop, db } = await requireShop("marketing");
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  try {
    const { batch, csv } = await codeBatchCsv(db, shop.id, id);
    const name = [shop.handle, "codes", batch.prefix.toLowerCase()].join("-");
    return new Response(csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
