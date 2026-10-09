import { exportCustomerData, NotFoundError } from "@sf/core";
import { requireShop } from "@/lib/server";

/** A copy of everything the store holds about one buyer, for a "send me my data" request. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { shop, db } = await requireShop("privacy");
  const { id } = await params;
  try {
    const data = await exportCustomerData(db, shop, id);
    const name = `customer-data-${data.customer.email.replace(/[^a-z0-9]+/gi, "-")}-${data.exported_at.slice(0, 10)}.json`;
    return new Response(JSON.stringify(data, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
