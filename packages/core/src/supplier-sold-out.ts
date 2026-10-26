// Sold out at the supplier: when every option of a product on sale runs out at its supplier (and
// at its backup supplier, if it has one), buyers can't order it. The team hears about it once,
// from the daily job, with a link to the product to add a backup supplier or take it off sale,
// and again only if it comes back and runs out again. Products taking pre-orders still sell, so
// they're left out, and so are products added by hand, whose stock is the merchant's own.
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import type { Mailer } from "./email";
import { openPreorder } from "./preorders";
import { can } from "./team";

type Product = typeof schema.products.$inferSelect;
export type SoldOutProduct = { id: string; shopId: string; title: string; hasBackup: boolean };

/** Of these products, the ones on sale from a supplier with every option at 0. */
async function soldOutOf(db: Db, products: Product[], now: Date): Promise<SoldOutProduct[]> {
  const candidates = products.filter((p) => p.status === "active" && p.sourceUrl && !openPreorder(p, now));
  if (!candidates.length) return [];
  const variants = await db
    .select({ productId: schema.variants.productId, stock: schema.variants.stock })
    .from(schema.variants)
    .where(inArray(schema.variants.productId, candidates.map((p) => p.id)));
  return candidates
    .filter((p) => {
      const mine = variants.filter((v) => v.productId === p.id);
      // No stock count means the supplier doesn't say, which the store treats as in stock.
      return mine.length > 0 && mine.every((v) => v.stock === 0);
    })
    .map((p) => ({ id: p.id, shopId: p.shopId, title: p.title, hasBackup: !!p.backup }));
}

/** For the Products page and Home: what's sold out at the supplier right now, by title. */
export async function soldOutAtSupplier(db: Db, shopId: string, now = new Date()) {
  const products = await db.query.products.findMany({
    where: and(eq(schema.products.shopId, shopId), eq(schema.products.status, "active"), isNotNull(schema.products.sourceUrl)),
  });
  return (await soldOutOf(db, products, now)).sort((a, b) => a.title.localeCompare(b.title));
}

const LISTED = 20;

/**
 * From the daily job, after the stock sync: products that are back get ready to be told about
 * again, and each store with newly sold-out products emails the people who look after products.
 * Claimed before sending, so two runs can't send it twice.
 */
export async function notifySoldOut(ctx: { db: Db; mailer: Mailer; adminUrl: (path: string) => string }, opts: { shopId?: string; now?: Date } = {}) {
  const { db } = ctx;
  const now = opts.now ?? new Date();
  const scope = opts.shopId ? eq(schema.products.shopId, opts.shopId) : undefined;

  const told = await db.query.products.findMany({ where: and(scope, isNotNull(schema.products.soldOutNotifiedAt)), limit: 1000 });
  const stillOut = new Set((await soldOutOf(db, told, now)).map((p) => p.id));
  const back = told.filter((p) => !stillOut.has(p.id)).map((p) => p.id);
  if (back.length) await db.update(schema.products).set({ soldOutNotifiedAt: null }).where(inArray(schema.products.id, back));

  const fresh = await db.query.products.findMany({
    where: and(scope, eq(schema.products.status, "active"), isNotNull(schema.products.sourceUrl), isNull(schema.products.soldOutNotifiedAt)),
    limit: 1000,
  });
  const out = await soldOutOf(db, fresh, now);
  let sent = 0;
  for (const shopId of new Set(out.map((p) => p.shopId))) {
    const ids = out.filter((p) => p.shopId === shopId).map((p) => p.id);
    const claimed = new Set(
      (
        await db
          .update(schema.products)
          .set({ soldOutNotifiedAt: now })
          .where(and(inArray(schema.products.id, ids), isNull(schema.products.soldOutNotifiedAt)))
          .returning({ id: schema.products.id })
      ).map((r) => r.id),
    );
    const mine = out.filter((p) => claimed.has(p.id)).sort((a, b) => a.title.localeCompare(b.title));
    if (!mine.length) continue;
    const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
    if (!shop || shop.status !== "active") continue;
    const people = await db
      .select({ email: schema.users.email, role: schema.shopMembers.role })
      .from(schema.shopMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.shopMembers.userId))
      .where(eq(schema.shopMembers.shopId, shopId));
    const one = mine.length === 1;
    const subject = one ? `${mine[0]!.title} sold out at the supplier (${shop.name})` : `${mine.length} products sold out at the supplier (${shop.name})`;
    const text = [
      `Hi,`,
      ``,
      `Your supplier has run out of every option of ${one ? "this product" : "these products"}, so buyers can't order ${one ? "it" : "them"} on ${shop.name} right now:`,
      ``,
      ...mine.slice(0, LISTED).map((p) => `  ${p.title}${p.hasBackup ? " (the backup supplier is out too)" : ""}: ${ctx.adminUrl(`/admin/products/${p.id}`)}`),
      ...(mine.length > LISTED ? [`  and ${mine.length - LISTED} more: ${ctx.adminUrl("/admin/products#supplier-sold-out")}`] : []),
      ``,
      `Add a backup supplier on the product page and orders go there instead, or take ${one ? "it" : "them"} off sale. We check stock every day, and the store sells ${one ? "it" : "them"} again by itself when the supplier restocks.`,
    ].join("\n");
    for (const p of people.filter((x) => can(x.role, "products"))) {
      await ctx.mailer.send({ to: p.email, subject, text });
      sent++;
    }
  }
  return { sent, back: back.length };
}
