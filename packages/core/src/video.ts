// Product videos: one per product, shown in the product page's gallery after the photos. A merchant
// pastes a YouTube or Vimeo link, or the address of a video file (suppliers often host one). The
// page shows the product's first photo with a play button and only loads the player when the buyer
// presses it, so nothing is fetched from YouTube or Vimeo for just opening the page.
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { parseVideo } from "./video-link";

export { parseVideo, type ProductVideo } from "./video-link";
/** Saves a product's video, or removes it when the link is empty. Gives what was saved. */
export async function setProductVideo(db: Db, shopId: string, productId: string, raw: string | null) {
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)), columns: { id: true } });
  if (!product) throw new NotFoundError("Product");
  const text = (raw ?? "").trim();
  if (text && !parseVideo(text)) {
    throw new UserError("Paste a YouTube or Vimeo link, or the https address of a video file ending in .mp4, .webm or .mov.");
  }
  await db.update(schema.products).set({ videoUrl: text || null, updatedAt: new Date() }).where(eq(schema.products.id, productId));
  return text ? parseVideo(text) : null;
}
