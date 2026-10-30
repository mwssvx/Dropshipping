// Coming soon: a product scheduled to go on sale later can show a teaser page at its usual address
// until then, with the time it goes on sale and a box to be emailed when it's out. The list is kept
// as back-in-stock requests marked `launch`, so the same scheduled sending emails everyone once the
// product is live (with the first store visit after its time, or the daily run).
import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";

const emailInput = z.string().trim().toLowerCase().email("Enter your email address.").max(320);

/** Turns the coming-soon page on or off for a product that's scheduled to go on sale. */
export async function setComingSoon(db: Db, shopId: string, productId: string, on: boolean) {
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)), columns: { id: true, status: true, publishAt: true } });
  if (!product) throw new NotFoundError("Product");
  if (on && (product.status !== "draft" || !product.publishAt)) throw new UserError("Pick when it goes on sale first. The coming-soon page counts down to that time.");
  await db.update(schema.products).set({ comingSoon: on, updatedAt: new Date() }).where(eq(schema.products.id, productId));
}

/** A draft showing its coming-soon page at `handle`, with its options, or null. */
export async function comingSoonProduct(db: Db, shopId: string, handle: string, now = new Date()) {
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.shopId, shopId), eq(schema.products.handle, handle), eq(schema.products.status, "draft"), eq(schema.products.comingSoon, true), gt(schema.products.publishAt, now)),
  });
  if (!product) return null;
  const variants = await db.query.variants.findMany({ where: eq(schema.variants.productId, product.id), orderBy: asc(schema.variants.position) });
  return variants.length ? { ...product, publishAt: product.publishAt!, variants } : null;
}

/** A shopper asks to be emailed when a coming-soon product goes on sale. Asking twice changes nothing. */
export async function joinLaunchList(db: Db, shopId: string, productId: string, email: string, now = new Date()) {
  const parsed = emailInput.safeParse(email);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)) });
  if (!product || !(await comingSoonProduct(db, shopId, product.handle, now))) throw new UserError("That product isn't coming soon any more.", "not_found");
  const first = await db.query.variants.findFirst({ where: eq(schema.variants.productId, productId), orderBy: asc(schema.variants.position), columns: { id: true } });
  await db
    .insert(schema.stockAlerts)
    .values({ shopId, variantId: first!.id, email: parsed.data, launch: true, createdAt: now })
    .onConflictDoNothing();
}

/** How many shoppers are waiting to hear a product is out. */
export async function launchListCount(db: Db, shopId: string, productId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(schema.stockAlerts)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.stockAlerts.variantId))
    .where(and(eq(schema.stockAlerts.shopId, shopId), eq(schema.variants.productId, productId), eq(schema.stockAlerts.launch, true), isNull(schema.stockAlerts.notifiedAt)));
  return row?.n ?? 0;
}
