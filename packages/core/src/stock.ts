// Stock: imported products re-read their stock and cost from the supplier every day, so the store
// stops selling what the supplier ran out of. Buyers can leave their email on a sold-out option and
// get one email when it's back, whether the supplier restocked or the merchant changed it by hand.
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import type { Mailer } from "./email";
import { NotFoundError, UserError } from "./errors";
import { SupplierError, type Suppliers } from "./suppliers";
import { refreshBackup, sellableStock } from "./backups";
import { recordCostChange } from "./price-watch";

type Shop = typeof schema.shops.$inferSelect;
const DAY = 86_400_000;
const ALERT_DAYS = 180;
const MAX_WAITING_PER_EMAIL = 20;

export type StockContext = {
  db: Db;
  suppliers: Suppliers;
  mailer: Mailer;
  /** The store's public address, like https://lumen.example.com, with no trailing slash. */
  storeAddress: (shop: Shop) => string | Promise<string>;
  now?: () => Date;
};

const inStock = (stock: number | null) => stock === null || stock > 0;

/* Supplier sync */

export type StockChange = { productId: string; variantId: string; option: string; stockBefore: number | null; stockAfter: number | null; costBefore: number | null; costAfter: number | null };

/**
 * Reads one product's stock and cost from its supplier and saves any change. A listing the
 * supplier took down counts as sold out. Products added by hand or from an own supplier have no
 * supplier listing and are left alone.
 */
export async function syncProductStock(ctx: Pick<StockContext, "db" | "suppliers" | "now">, shopId: string, productId: string) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)) });
  if (!product) throw new NotFoundError("Product");
  if (!product.sourceUrl) throw new UserError("This product isn't linked to a supplier listing, so its stock is yours to set.", "no_supplier");
  const variants = await db.query.variants.findMany({ where: eq(schema.variants.productId, product.id), orderBy: asc(schema.variants.position) });

  let remote: Map<string, { stock: number | null; costMinor: number }> | null;
  try {
    const listing = await ctx.suppliers.forUrl(product.sourceUrl).getProductFromUrl(product.sourceUrl);
    remote = new Map(listing.variants.map((v) => [v.ref, { stock: v.stock, costMinor: v.costMinor }]));
  } catch (e) {
    if (!(e instanceof SupplierError)) throw e;
    // Retry later when the supplier is down; a missing listing means it's gone.
    if (e.code !== "product_unavailable") throw new UserError(e.message, e.code);
    remote = null;
  }

  // With a backup supplier the store can sell what either of them has.
  const backup = product.backup ? await refreshBackup(ctx.suppliers, product.backup, now) : null;
  const changes: StockChange[] = [];
  let shop: typeof schema.shops.$inferSelect | undefined;
  for (const v of variants) {
    if (!v.supplierVariantRef) continue;
    const r = remote ? remote.get(v.supplierVariantRef) : undefined;
    // An option the supplier no longer lists is sold out; its cost stays as it was.
    const stock = sellableStock(r ? r.stock : 0, backup?.variants[v.id]);
    const cost = r ? r.costMinor : v.costMinor;
    if (stock === v.stock && cost === v.costMinor) continue;
    await db.update(schema.variants).set({ stock, costMinor: cost }).where(eq(schema.variants.id, v.id));
    if (v.costMinor !== null && cost !== null && cost > v.costMinor) {
      shop ??= (await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) }))!;
      await recordCostChange(db, shop, v, v.costMinor, cost, now);
    }
    changes.push({ productId: product.id, variantId: v.id, option: v.title, stockBefore: v.stock, stockAfter: stock, costBefore: v.costMinor, costAfter: cost });
  }
  await db.update(schema.products).set({ stockCheckedAt: now, ...(backup ? { backup } : {}) }).where(eq(schema.products.id, product.id));
  return { gone: remote === null, backupLive: !!backup && !backup.gone, changes };
}

/**
 * The scheduled job: products on sale that haven't been checked for a day, oldest first. A
 * supplier that fails is skipped and tried again next run.
 */
export async function syncSupplierStock(ctx: Pick<StockContext, "db" | "suppliers" | "now">, opts: { limit?: number } = {}) {
  const now = ctx.now?.() ?? new Date();
  const due = await ctx.db
    .select({ id: schema.products.id, shopId: schema.products.shopId })
    .from(schema.products)
    .where(
      and(
        inArray(schema.products.status, ["active", "draft"]),
        isNotNull(schema.products.sourceUrl),
        or(isNull(schema.products.stockCheckedAt), lt(schema.products.stockCheckedAt, new Date(now.getTime() - DAY))),
      ),
    )
    .orderBy(sql`${schema.products.stockCheckedAt} asc nulls first`)
    .limit(opts.limit ?? 200);
  let checked = 0;
  let changed = 0;
  let failed = 0;
  for (const p of due) {
    try {
      changed += (await syncProductStock(ctx, p.shopId, p.id)).changes.length;
      checked++;
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      failed++;
    }
  }
  return { checked, changed, failed };
}

/* Back-in-stock alerts */

const alertInput = z.object({
  variantId: z.string().uuid("Pick the option you want."),
  email: z.string().trim().toLowerCase().email("Enter your email address.").max(320),
});

/** A buyer asks to hear when a sold-out option is back. Asking again is fine and changes nothing. */
export async function requestStockAlert(db: Db, shopId: string, input: z.input<typeof alertInput>, now = new Date()) {
  const parsed = alertInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { variantId, email } = parsed.data;
  const [row] = await db
    .select({ variant: schema.variants, product: schema.products })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.variants.id, variantId), eq(schema.products.shopId, shopId), eq(schema.products.status, "active")));
  if (!row) throw new UserError("That product isn't available.", "not_found");
  if (inStock(row.variant.stock)) throw new UserError("Good news: it's in stock now.", "in_stock");
  const [waiting] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.stockAlerts)
    .where(and(eq(schema.stockAlerts.shopId, shopId), eq(schema.stockAlerts.email, email), isNull(schema.stockAlerts.notifiedAt)));
  if ((waiting?.n ?? 0) >= MAX_WAITING_PER_EMAIL) throw new UserError("You're already waiting on lots of items here. We'll email you as they come back.", "too_many");
  await db
    .insert(schema.stockAlerts)
    .values({ shopId, variantId, email, createdAt: now })
    .onConflictDoUpdate({ target: [schema.stockAlerts.variantId, schema.stockAlerts.email], set: { notifiedAt: null, createdAt: now } });
}

/**
 * Emails everyone waiting on an option that can be bought again, once each. Runs on the schedule,
 * and straight away for one store after the merchant changes stock or checks the supplier.
 */
export async function sendStockAlerts(ctx: Pick<StockContext, "db" | "mailer" | "storeAddress" | "now">, scope: { shopId?: string; limit?: number } = {}) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const due = await db
    .select({ alert: schema.stockAlerts, variant: { title: schema.variants.title }, product: { title: schema.products.title, handle: schema.products.handle } })
    .from(schema.stockAlerts)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.stockAlerts.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(
      and(
        isNull(schema.stockAlerts.notifiedAt),
        eq(schema.products.status, "active"),
        sql`(${schema.variants.stock} is null or ${schema.variants.stock} > 0)`,
        scope.shopId ? eq(schema.stockAlerts.shopId, scope.shopId) : undefined,
      ),
    )
    .limit(scope.limit ?? 500);
  const shops = new Map<string, Shop>();
  let sent = 0;
  for (const d of due) {
    let shop = shops.get(d.alert.shopId);
    if (!shop) {
      shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, d.alert.shopId) }))!;
      shops.set(shop.id, shop);
    }
    // Claim it first, so two runs at once don't both send.
    const [claimed] = await db
      .update(schema.stockAlerts)
      .set({ notifiedAt: now })
      .where(and(eq(schema.stockAlerts.id, d.alert.id), isNull(schema.stockAlerts.notifiedAt)))
      .returning({ id: schema.stockAlerts.id });
    if (!claimed) continue;
    const name = d.variant.title === "Default" ? d.product.title : `${d.product.title} (${d.variant.title})`;
    const link = `${await ctx.storeAddress(shop)}/products/${d.product.handle}`;
    try {
      await ctx.mailer.send({
        to: d.alert.email,
        subject: d.alert.launch ? `Out now: ${d.product.title}` : `Back in stock: ${d.product.title}`,
        text: [
          `Hi,`,
          ``,
          d.alert.launch ? `${d.product.title} is on sale now at ${shop.name}. You asked us to let you know.` : `${name} is back in stock at ${shop.name}. You asked us to let you know.`,
          ``,
          `Get it here: ${link}`,
          ``,
          d.alert.launch ? `This is the only email you'll get about it. There may not be many, so don't wait too long.` : `This is the only email you'll get about it. Stock can run out again, so don't wait too long.`,
        ].join("\n"),
      });
      sent++;
    } catch {
      // Put it back so the next run tries again.
      await db.update(schema.stockAlerts).set({ notifiedAt: null }).where(eq(schema.stockAlerts.id, d.alert.id));
    }
  }
  return { sent };
}

/** The most "Only N left" can count up to. */
export const LOW_STOCK_MAX = 50;

/** Product pages say "Only N left" when an option's stock is at or below `n`; 0 turns it off. */
export async function setLowStockNote(db: Db, shopId: string, n: number) {
  if (!Number.isInteger(n) || n < 0 || n > LOW_STOCK_MAX) throw new UserError(`Pick a number from 0 to ${LOW_STOCK_MAX}. 0 turns the note off.`);
  await db.update(schema.shops).set({ lowStockNote: n, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return n;
}

/**
 * How many to tell the buyer are left, when it's few enough to say so. Only real counts: never for
 * options with no stock count, and never once they're sold out.
 */
export function lowStockLeft(shop: Pick<Shop, "lowStockNote">, stock: number | null) {
  return stock != null && stock > 0 && stock <= shop.lowStockNote ? stock : null;
}

/** Buyers waiting on each option of a product, for the merchant. */
export async function waitingForProduct(db: Db, shopId: string, productId: string) {
  const rows = await db
    .select({ variantId: schema.stockAlerts.variantId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.stockAlerts)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.stockAlerts.variantId))
    .where(and(eq(schema.stockAlerts.shopId, shopId), eq(schema.variants.productId, productId), isNull(schema.stockAlerts.notifiedAt), eq(schema.stockAlerts.launch, false)))
    .groupBy(schema.stockAlerts.variantId);
  return new Map(rows.map((r) => [r.variantId, r.n]));
}

/** Waiting buyers per product across the store, most wanted first. */
export async function mostWanted(db: Db, shopId: string, limit = 10) {
  return db
    .select({ productId: schema.products.id, title: schema.products.title, waiting: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.stockAlerts)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.stockAlerts.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.stockAlerts.shopId, shopId), isNull(schema.stockAlerts.notifiedAt), eq(schema.stockAlerts.launch, false)))
    .groupBy(schema.products.id, schema.products.title)
    .orderBy(sql`count(*) desc`)
    .limit(limit);
}

/** Old requests go: sent ones after a month, unsent ones after six months. */
export async function pruneStockAlerts(db: Db, now = new Date()) {
  await db
    .delete(schema.stockAlerts)
    .where(
      or(
        lt(schema.stockAlerts.notifiedAt, new Date(now.getTime() - 30 * DAY)),
        and(isNull(schema.stockAlerts.notifiedAt), lt(schema.stockAlerts.createdAt, new Date(now.getTime() - ALERT_DAYS * DAY))),
      ),
    );
}
