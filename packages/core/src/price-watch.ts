// Supplier price watch: when the daily stock sync sees a supplier charge more for an option, we
// note it. If the rise leaves less margin than the merchant wants, they hear about it once by
// email and can raise the price (to what their pricing rule gives) or keep it with one click.
// With "raise prices automatically" on, the store raises it straight away and says so.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { can } from "./team";
import type { Mailer } from "./email";
import { NotFoundError, UserError } from "./errors";
import { formatMoney } from "./money";
import { priceFromCost, pricingRuleOf } from "./pricing";

type Shop = typeof schema.shops.$inferSelect;
type Variant = typeof schema.variants.$inferSelect;

/** What's left of the price after the supplier's cost, as a whole percent. */
export function marginPercent(priceMinor: number, costMinor: number) {
  return priceMinor > 0 ? Math.floor(((priceMinor - costMinor) / priceMinor) * 100) : 0;
}

const settingsSchema = z.object({
  minMarginPercent: z.number().int("Enter a whole percent.").min(0, "Use a margin from 0% to 90%.").max(90, "Use a margin from 0% to 90%."),
  autoReprice: z.boolean(),
});

export async function setPriceWatch(db: Db, shopId: string, input: z.input<typeof settingsSchema>) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  await db.update(schema.shops).set({ ...parsed.data, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return parsed.data;
}

/** The price the pricing rule gives for this cost, never lower than today's price. */
export function suggestedPrice(shop: Pick<Shop, "pricingRule">, priceMinor: number, costMinor: number) {
  return Math.max(priceMinor, priceFromCost(costMinor, pricingRuleOf(shop)));
}

/**
 * Called by the stock sync when an option's cost changes. A rise is noted (merged into an open
 * note for the same option, so a cost that climbs twice is one thing to look at); with automatic
 * repricing on, the price goes up at once. A drop is left alone: lower costs are good news.
 */
export async function recordCostChange(db: Db, shop: Shop, variant: Pick<Variant, "id" | "productId" | "priceMinor">, costBefore: number, costAfter: number, now = new Date()) {
  if (costAfter <= costBefore) return null;
  const open = await db.query.costChanges.findFirst({ where: and(eq(schema.costChanges.variantId, variant.id), eq(schema.costChanges.status, "open")) });
  const raiseTo = suggestedPrice(shop, variant.priceMinor, costAfter);
  if (shop.autoReprice && raiseTo > variant.priceMinor) {
    await db.update(schema.variants).set({ priceMinor: raiseTo }).where(eq(schema.variants.id, variant.id));
    if (open) await db.delete(schema.costChanges).where(eq(schema.costChanges.id, open.id));
    const [row] = await db
      .insert(schema.costChanges)
      .values({
        shopId: shop.id,
        productId: variant.productId,
        variantId: variant.id,
        costBeforeMinor: open?.costBeforeMinor ?? costBefore,
        costAfterMinor: costAfter,
        priceMinor: open?.priceMinor ?? variant.priceMinor,
        newPriceMinor: raiseTo,
        status: "repriced",
        resolvedAt: now,
        createdAt: now,
      })
      .returning();
    return row!;
  }
  if (open) {
    const [row] = await db.update(schema.costChanges).set({ costAfterMinor: costAfter, notifiedAt: null }).where(eq(schema.costChanges.id, open.id)).returning();
    return row!;
  }
  const [row] = await db
    .insert(schema.costChanges)
    .values({ shopId: shop.id, productId: variant.productId, variantId: variant.id, costBeforeMinor: costBefore, costAfterMinor: costAfter, priceMinor: variant.priceMinor, createdAt: now })
    .returning();
  return row!;
}

/** Price rises from suppliers, open ones first, with today's price and margins and the suggested price. */
export async function listCostChanges(db: Db, shop: Shop, opts: { limit?: number } = {}) {
  const rows = await db
    .select({ change: schema.costChanges, title: schema.products.title, option: schema.variants.title, price: schema.variants.priceMinor, cost: schema.variants.costMinor })
    .from(schema.costChanges)
    .innerJoin(schema.products, eq(schema.products.id, schema.costChanges.productId))
    .innerJoin(schema.variants, eq(schema.variants.id, schema.costChanges.variantId))
    .where(eq(schema.costChanges.shopId, shop.id))
    .orderBy(desc(schema.costChanges.createdAt))
    .limit(opts.limit ?? 100);
  const rank = (s: string) => (s === "open" ? 0 : 1);
  return rows
    .map((r) => ({
      ...r.change,
      title: r.option === "Default" ? r.title : `${r.title} – ${r.option}`,
      currentPriceMinor: r.price,
      marginBefore: marginPercent(r.change.priceMinor, r.change.costBeforeMinor),
      marginNow: marginPercent(r.price, r.change.costAfterMinor),
      suggestedPriceMinor: suggestedPrice(shop, r.price, r.change.costAfterMinor),
      belowTarget: marginPercent(r.price, r.change.costAfterMinor) < shop.minMarginPercent,
    }))
    .sort((a, b) => rank(a.status) - rank(b.status));
}

/** Open rises that leave less margin than the merchant wants, for the nav badge. */
export async function countCostAlerts(db: Db, shop: Shop) {
  return (await listCostChanges(db, shop)).filter((c) => c.status === "open" && c.belowTarget).length;
}

/** Raise the price to the suggested one, or keep it. */
export async function resolveCostChange(db: Db, shop: Shop, id: string, action: "raise" | "keep", now = new Date()) {
  const change = await db.query.costChanges.findFirst({ where: and(eq(schema.costChanges.id, id), eq(schema.costChanges.shopId, shop.id)) });
  if (!change) throw new NotFoundError("Price change");
  if (change.status !== "open") throw new UserError("This price change was already dealt with.");
  if (action === "keep") {
    const [row] = await db.update(schema.costChanges).set({ status: "kept", resolvedAt: now }).where(eq(schema.costChanges.id, id)).returning();
    return row!;
  }
  const variant = (await db.query.variants.findFirst({ where: eq(schema.variants.id, change.variantId) }))!;
  const to = suggestedPrice(shop, variant.priceMinor, change.costAfterMinor);
  if (to <= variant.priceMinor) throw new UserError("Your pricing rule wouldn't raise this price. Change it on the product, or keep it.");
  await db.update(schema.variants).set({ priceMinor: to }).where(eq(schema.variants.id, variant.id));
  const [row] = await db.update(schema.costChanges).set({ status: "raised", newPriceMinor: to, resolvedAt: now }).where(eq(schema.costChanges.id, id)).returning();
  return row!;
}

/**
 * Once a day: one email per store listing new rises that leave less margin than the merchant wants,
 * and prices raised automatically. Everyone who manages products gets it.
 */
export async function notifyCostChanges(ctx: { db: Db; mailer: Mailer; adminUrl: (path: string) => string }, opts: { shopId?: string; now?: Date } = {}) {
  const { db } = ctx;
  const now = opts.now ?? new Date();
  const fresh = await db.query.costChanges.findMany({
    where: and(isNull(schema.costChanges.notifiedAt), inArray(schema.costChanges.status, ["open", "repriced"]), opts.shopId ? eq(schema.costChanges.shopId, opts.shopId) : undefined),
    limit: 500,
  });
  let sent = 0;
  for (const shopId of new Set(fresh.map((c) => c.shopId))) {
    const ids = fresh.filter((c) => c.shopId === shopId).map((c) => c.id);
    const claimed = await db
      .update(schema.costChanges)
      .set({ notifiedAt: now })
      .where(and(inArray(schema.costChanges.id, ids), isNull(schema.costChanges.notifiedAt)))
      .returning({ id: schema.costChanges.id });
    if (!claimed.length) continue;
    const shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) }))!;
    const mine = new Set(claimed.map((c) => c.id));
    const changes = (await listCostChanges(db, shop, { limit: 500 })).filter((c) => mine.has(c.id));
    const low = changes.filter((c) => c.status === "open" && c.belowTarget);
    const raised = changes.filter((c) => c.status === "repriced");
    // A small rise that still leaves a healthy margin isn't worth an email.
    if (!low.length && !raised.length) continue;
    const money = (m: number) => formatMoney(m, shop.currency);
    const text = [`Hi,`, ``];
    if (low.length) {
      text.push(`Your supplier now charges more for ${low.length === 1 ? "this item" : "these items"}, leaving less than your ${shop.minMarginPercent}% margin:`, ``);
      for (const c of low) text.push(`  ${c.title}: cost ${money(c.costBeforeMinor)} → ${money(c.costAfterMinor)}, price ${money(c.currentPriceMinor)}, margin ${c.marginNow}%`);
      text.push(``, `Raise the price or keep it, in one click: ${ctx.adminUrl("/admin/price-changes")}`, ``);
    }
    if (raised.length) {
      text.push(`We raised ${raised.length === 1 ? "this price" : "these prices"} with your pricing rule, as you asked:`, ``);
      for (const c of raised) text.push(`  ${c.title}: cost ${money(c.costBeforeMinor)} → ${money(c.costAfterMinor)}, price ${money(c.priceMinor)} → ${money(c.newPriceMinor!)}`);
      text.push(``, `See them all: ${ctx.adminUrl("/admin/price-changes")}`);
    }
    const people = await db
      .select({ email: schema.users.email, role: schema.shopMembers.role })
      .from(schema.shopMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.shopMembers.userId))
      .where(eq(schema.shopMembers.shopId, shopId));
    const subject = low.length
      ? `${low.length} supplier price ${low.length === 1 ? "rise needs" : "rises need"} a look at ${shop.name}`
      : `We raised ${raised.length} ${raised.length === 1 ? "price" : "prices"} at ${shop.name} after supplier rises`;
    for (const p of people.filter((x) => can(x.role, "products"))) {
      await ctx.mailer.send({ to: p.email, subject, text: text.join("\n").trimEnd() });
      sent++;
    }
  }
  return { sent };
}

/** Saves a new supplier cost for an option of this store, noting it if it's a rise. */
export async function applySupplierCost(db: Db, shop: Shop, variantId: string, costMinor: number, now = new Date()) {
  const [row] = await db
    .select({ variant: schema.variants })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.variants.id, variantId), eq(schema.products.shopId, shop.id)));
  if (!row) throw new NotFoundError("Option");
  await db.update(schema.variants).set({ costMinor }).where(eq(schema.variants.id, variantId));
  return row.variant.costMinor === null ? null : recordCostChange(db, shop, row.variant, row.variant.costMinor, costMinor, now);
}
