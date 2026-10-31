import { can, reviewPhotoUrl, reviewsCsv, type ReviewStatus } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";

const STATUSES: ReviewStatus[] = ["pending", "published", "hidden"];

/** The reviews as a spreadsheet, with the Reviews page's tab, stars, search and filters, or all of them. */
export async function GET(request: Request) {
  const { shop, db, role } = await requireShop("reviews");
  const p = new URL(request.url).searchParams;
  const status = STATUSES.find((s) => s === p.get("show"));
  const rating = /^[1-5]$/.test(p.get("stars") ?? "") ? Number(p.get("stars")) : undefined;
  // Photo links point at the store, so the file still works once it's somewhere else.
  const origin = await storeAddress(shop);
  const csv = await reviewsCsv(db, shop.id, {
    status,
    rating,
    query: p.get("q")?.trim().slice(0, 100) || undefined,
    noReply: p.get("reply") === "none",
    photos: p.get("photos") === "1",
    reported: p.get("reported") === "1",
    // reviewListWhere keeps it to this store, so another store's product id finds nothing.
    productId: /^[0-9a-f-]{36}$/i.test(p.get("product") ?? "") ? p.get("product")! : undefined,
    emails: can(role, "customers"),
    photoUrl: (id) => new URL(reviewPhotoUrl(id), origin).toString(),
  });
  const name = [shop.handle, "reviews", status].filter(Boolean).join("-");
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" },
  });
}
