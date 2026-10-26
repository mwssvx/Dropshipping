// Put a product on sale later: a draft gets a time, and goes on sale by itself then, for a launch
// or a drop announced in advance. The store makes due products live whenever it's visited and on
// the scheduled job, so a product goes on sale with the first visitor after its time.
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

const DAY = 86_400_000;
export const PUBLISH_LATER_MAX_DAYS = 365;

/** Sets when a draft goes on sale, or clears it with null. */
export async function schedulePublish(db: Db, shopId: string, productId: string, at: Date | null, now = new Date()) {
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)),
    columns: { id: true, status: true },
  });
  if (!product) throw new NotFoundError("Product");
  if (at) {
    if (product.status !== "draft") throw new UserError("Only a draft can be put on sale later. This one is already " + (product.status === "active" ? "on sale." : "archived."));
    if (Number.isNaN(at.getTime())) throw new UserError("Pick a date and time.");
    if (at.getTime() <= now.getTime() + 60_000) throw new UserError("Pick a time in the future, or put it on sale now.");
    if (at.getTime() > now.getTime() + PUBLISH_LATER_MAX_DAYS * DAY) throw new UserError(`Pick a time within ${PUBLISH_LATER_MAX_DAYS} days.`);
  }
  await db.update(schema.products).set({ publishAt: at, updatedAt: now }).where(eq(schema.products.id, productId));
}

/** Puts drafts whose time has come on sale, for one store or all of them. Returns what went live. */
export async function publishDueProducts(db: Db, shopId?: string, now = new Date()) {
  return db
    .update(schema.products)
    .set({ status: "active", publishAt: null, updatedAt: now })
    .where(
      and(
        shopId ? eq(schema.products.shopId, shopId) : undefined,
        eq(schema.products.status, "draft"),
        isNotNull(schema.products.publishAt),
        lte(schema.products.publishAt, now),
      ),
    )
    .returning({ id: schema.products.id, shopId: schema.products.shopId, title: schema.products.title });
}
