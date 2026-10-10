// Profit report: what each product really earns over a period, after discounts, refunds, the
// supplier's cost, card and sales fees, and the ad spend the merchant enters. Dropshippers live on
// paid ads, so "sales minus cost" isn't the number that matters; profit after ads is.
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { AD_CHANNELS, schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";

type Shop = typeof schema.shops.$inferSelect;
export type AdChannel = (typeof AD_CHANNELS)[number];

const DAY = 86_400_000;
export const PROFIT_RANGES = [7, 30, 90] as const;
export type ProfitRange = (typeof PROFIT_RANGES)[number];

export const AD_CHANNEL_LABELS: Record<AdChannel, string> = {
  meta: "Facebook and Instagram",
  google: "Google",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
  other: "Other",
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const adInput = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day you spent it."),
  channel: z.enum(AD_CHANNELS, { message: "Pick where the ads ran." }),
  amountMinor: z.number().int().min(1, "Enter how much you spent.").max(100_000_000, "That's more than we can record in one go."),
  productId: z.string().uuid().nullish(),
  note: z.string().trim().max(200).nullish(),
});

/** Records ad spend for a day. Tie it to a product to see that product's profit after ads. */
export async function addAdSpend(db: Db, shopId: string, input: z.input<typeof adInput>, opts: { userId?: string | null; now?: Date } = {}) {
  const parsed = adInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { day, channel, amountMinor, productId, note } = parsed.data;
  const now = opts.now ?? new Date();
  if (Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new UserError("Pick the day you spent it.");
  if (day > isoDay(now)) throw new UserError("That day hasn't happened yet.");
  if (day < isoDay(new Date(now.getTime() - 400 * DAY))) throw new UserError("Enter spend from the last year.");
  if (productId) {
    const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)), columns: { id: true } });
    if (!product) throw new NotFoundError("Product");
  }
  const [row] = await db
    .insert(schema.adSpend)
    .values({ shopId, day, channel, amountMinor, productId: productId ?? null, note: note || null, createdBy: opts.userId ?? null })
    .returning();
  return row!;
}

export async function deleteAdSpend(db: Db, shopId: string, id: string) {
  const [row] = await db.delete(schema.adSpend).where(and(eq(schema.adSpend.id, id), eq(schema.adSpend.shopId, shopId))).returning({ id: schema.adSpend.id });
  if (!row) throw new NotFoundError("Ad spend");
}

/** The days a report covers: the last N days, today included. */
export function profitWindow(days: number, now = new Date()) {
  const to = isoDay(now);
  const from = isoDay(new Date(now.getTime() - (days - 1) * DAY));
  return { from, to, start: new Date(`${from}T00:00:00Z`), end: new Date(`${to}T23:59:59.999Z`) };
}

export async function listAdSpend(db: Db, shopId: string, from: string, to: string) {
  return db.query.adSpend.findMany({
    where: and(eq(schema.adSpend.shopId, shopId), gte(schema.adSpend.day, from), lte(schema.adSpend.day, to)),
    orderBy: [asc(schema.adSpend.day), asc(schema.adSpend.createdAt)],
  });
}

export type ProductProfit = {
  productId: string | null;
  title: string;
  units: number;
  salesMinor: number;
  refundsMinor: number;
  costMinor: number;
  feesMinor: number;
  adsMinor: number;
  profitMinor: number;
  /** Profit as a share of sales after refunds, in percent. */
  marginPercent: number | null;
  /** Sales per unit of ad spend. */
  roas: number | null;
  /** The ROAS at which ads eat all the profit. Below it, ads lose money. */
  breakEvenRoas: number | null;
  /** Some lines had no supplier cost, so profit is overstated. */
  costMissing: boolean;
};

const PAID = ["paid", "partially_refunded", "refunded"] as const;

/**
 * Profit per product over the last N days. Shipping charged is assumed to cover the supplier's
 * shipping and tax goes to the tax office, so neither counts as sales (as on the Money page). An
 * order's discount, refunds and fees are shared across its lines by their value. The supplier's
 * cost counts once an order was sent to them, refunded or not, because that money is gone.
 */
export async function profitReport(db: Db, shop: Shop, days: ProfitRange, now = new Date()) {
  const window = profitWindow(days, now);
  const o = schema.orders;
  const orders = await db.query.orders.findMany({
    where: and(eq(o.shopId, shop.id), inArray(o.paymentStatus, [...PAID]), gte(o.paidAt, window.start), lte(o.paidAt, window.end)),
  });
  const orderIds = orders.map((x) => x.id);
  const lines = orderIds.length ? await db.query.orderLines.findMany({ where: inArray(schema.orderLines.orderId, orderIds) }) : [];
  // Orders a supplier has accepted: their cost is spent even if the buyer is refunded later.
  const placed = new Set(
    orderIds.length
      ? (await db.query.fulfillments.findMany({ where: and(inArray(schema.fulfillments.orderId, orderIds), inArray(schema.fulfillments.status, ["placed", "shipped", "delivered"])), columns: { orderId: true } })).map((f) => f.orderId)
      : [],
  );
  // Our sales fee comes back with a refund; the card fee doesn't.
  const feeBack = new Map<string, number>();
  if (orderIds.length) {
    for (const r of await db.query.refunds.findMany({ where: inArray(schema.refunds.orderId, orderIds), columns: { orderId: true, platformFeeRefundedMinor: true } })) {
      feeBack.set(r.orderId, (feeBack.get(r.orderId) ?? 0) + r.platformFeeRefundedMinor);
    }
  }
  const variantIds = [...new Set(lines.map((l) => l.variantId).filter((x): x is string => !!x))];
  const variants = variantIds.length ? await db.query.variants.findMany({ where: inArray(schema.variants.id, variantIds), columns: { id: true, productId: true } }) : [];
  const productIds = [...new Set(variants.map((v) => v.productId))];
  const ads = await listAdSpend(db, shop.id, window.from, window.to);
  for (const a of ads) if (a.productId && !productIds.includes(a.productId)) productIds.push(a.productId);
  const products = productIds.length ? await db.query.products.findMany({ where: inArray(schema.products.id, productIds), columns: { id: true, title: true, giftCard: true } }) : [];
  const productOf = new Map(variants.map((v) => [v.id, v.productId]));
  const productById = new Map(products.map((p) => [p.id, p]));

  const rows = new Map<string, ProductProfit>();
  const row = (productId: string | null, fallback: string) => {
    const key = productId ?? `line:${fallback}`;
    let r = rows.get(key);
    if (!r) {
      r = { productId, title: (productId && productById.get(productId)?.title) || fallback, units: 0, salesMinor: 0, refundsMinor: 0, costMinor: 0, feesMinor: 0, adsMinor: 0, profitMinor: 0, marginPercent: null, roas: null, breakEvenRoas: null, costMissing: false };
      rows.set(key, r);
    }
    return r;
  };

  let giftCardSalesMinor = 0;
  for (const order of orders) {
    const own = lines.filter((l) => l.orderId === order.id);
    const gross = own.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0);
    if (!gross) {
      // A free replacement sells nothing, but the goods it sends again still cost money.
      if (order.source === "replacement" && placed.has(order.id)) {
        for (const l of own) {
          const r = row(l.variantId ? (productOf.get(l.variantId) ?? null) : null, l.title);
          if (l.unitCostMinor == null) r.costMissing = true;
          else r.costMinor += l.unitCostMinor * l.quantity;
        }
      }
      continue;
    }
    // What the buyer paid for the goods: after discount, before shipping and tax.
    const goods = order.totalMinor - order.shippingMinor - order.taxMinor;
    const refundedGoods = order.totalMinor ? Math.round((order.refundedMinor * goods) / order.totalMinor) : 0;
    const fees = order.platformFeeMinor + order.processingFeeMinor - (feeBack.get(order.id) ?? 0);
    const sent = placed.has(order.id);
    for (const l of own) {
      const share = (l.unitPriceMinor * l.quantity) / gross;
      const productId = l.variantId ? (productOf.get(l.variantId) ?? null) : null;
      // A gift card is money held for the buyer, not a sale; it's counted when it's spent.
      if (productId && productById.get(productId)?.giftCard) {
        giftCardSalesMinor += Math.round(goods * share);
        continue;
      }
      const r = row(productId, l.title);
      r.units += l.quantity;
      r.salesMinor += Math.round(goods * share);
      r.refundsMinor += Math.round(refundedGoods * share);
      r.feesMinor += Math.round(fees * share);
      if (sent) {
        if (l.unitCostMinor == null) r.costMissing = true;
        else r.costMinor += l.unitCostMinor * l.quantity;
      }
    }
  }

  let untiedAdsMinor = 0;
  const byChannel = new Map<AdChannel, number>();
  for (const a of ads) {
    byChannel.set(a.channel, (byChannel.get(a.channel) ?? 0) + a.amountMinor);
    if (a.productId && productById.has(a.productId)) row(a.productId, productById.get(a.productId)!.title).adsMinor += a.amountMinor;
    else untiedAdsMinor += a.amountMinor;
  }

  const finish = (r: Omit<ProductProfit, "profitMinor" | "marginPercent" | "roas" | "breakEvenRoas">) => {
    const net = r.salesMinor - r.refundsMinor;
    const beforeAds = net - r.costMinor - r.feesMinor;
    const profitMinor = beforeAds - r.adsMinor;
    return {
      ...r,
      profitMinor,
      marginPercent: net > 0 ? Math.round((profitMinor / net) * 1000) / 10 : null,
      roas: r.adsMinor > 0 ? Math.round((net / r.adsMinor) * 100) / 100 : null,
      breakEvenRoas: beforeAds > 0 && net > 0 ? Math.round((net / beforeAds) * 100) / 100 : null,
    };
  };
  const products_ = [...rows.values()].map(finish).sort((a, b) => b.profitMinor - a.profitMinor || a.title.localeCompare(b.title));
  const sum = (k: keyof Pick<ProductProfit, "units" | "salesMinor" | "refundsMinor" | "costMinor" | "feesMinor" | "adsMinor">) => products_.reduce((s, r) => s + r[k], 0);
  const totals = finish({
    productId: null,
    title: "All products",
    units: sum("units"),
    salesMinor: sum("salesMinor"),
    refundsMinor: sum("refundsMinor"),
    costMinor: sum("costMinor"),
    feesMinor: sum("feesMinor"),
    adsMinor: sum("adsMinor") + untiedAdsMinor,
    costMissing: products_.some((r) => r.costMissing),
  });
  return {
    currency: shop.currency,
    days,
    from: window.from,
    to: window.to,
    orders: orders.length,
    totals,
    products: products_,
    /** Ad spend not tied to a product; it comes off the total only. */
    untiedAdsMinor,
    adsByChannel: AD_CHANNELS.filter((c) => byChannel.has(c)).map((c) => ({ channel: c, label: AD_CHANNEL_LABELS[c], amountMinor: byChannel.get(c)! })),
    giftCardSalesMinor,
    ads,
  };
}

export type ProfitReport = Awaited<ReturnType<typeof profitReport>>;
