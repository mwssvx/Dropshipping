// Pricing rules: how a supplier cost becomes a retail price. One rule per store prices every new
// import, and "reprice" brings existing products in line after the merchant sees a preview.
import { and, eq, inArray, ne } from "drizzle-orm";
import { schema, type Db, type PricingRule } from "@sf/db";
import { z } from "zod";
import { UserError } from "./errors";
import { estimateProcessingFee, platformFeeFor } from "./plans";

type Shop = typeof schema.shops.$inferSelect;

/** About 2.5 times cost, ending in .99: what imports used before stores could set a rule. */
export const DEFAULT_PRICING_RULE: PricingRule = { kind: "multiplier", value: 2.5, ending: "99", compareAtPercent: null, minPriceMinor: 99 };

export const pricingRuleOf = (shop: Pick<Shop, "pricingRule">): PricingRule => shop.pricingRule ?? DEFAULT_PRICING_RULE;

/** Up to the next whole amount, then the chosen ending: 13.98 and 14.00 both become 13.99. */
function round(exact: number, ending: PricingRule["ending"]) {
  switch (ending) {
    case "99":
      return Math.ceil(exact / 100) * 100 - 1;
    case "95":
      return Math.ceil(exact / 100) * 100 - 5;
    case "00":
      return Math.ceil(exact / 100) * 100;
    default:
      return Math.ceil(exact);
  }
}

export function priceFromCost(costMinor: number, rule: PricingRule = DEFAULT_PRICING_RULE) {
  const exact = rule.kind === "multiplier" ? costMinor * rule.value : costMinor + rule.value;
  return Math.max(rule.minPriceMinor, round(Math.max(0, exact), rule.ending));
}

/** The crossed-out "was" price for a price, or null when the rule doesn't show one. */
export function compareAtFor(priceMinor: number, rule: PricingRule = DEFAULT_PRICING_RULE) {
  if (!rule.compareAtPercent) return null;
  return round(priceMinor * (1 + rule.compareAtPercent / 100), rule.ending);
}

/** Roughly what the merchant keeps from one sale at this price, after cost and fees. */
export function keepsFromSale(shop: Pick<Shop, "plan">, priceMinor: number, costMinor: number) {
  return priceMinor - costMinor - estimateProcessingFee(priceMinor) - platformFeeFor(shop.plan, priceMinor);
}

const ruleInput = z
  .object({
    kind: z.enum(["multiplier", "fixed"]),
    value: z.number().finite(),
    ending: z.enum(["99", "95", "00", "none"]),
    compareAtPercent: z.number().int().min(0).max(300, "Keep the crossed-out price within 300% of the price.").nullable(),
    minPriceMinor: z.number().int().min(0).max(1_000_000).default(99),
  })
  .superRefine((r, ctx) => {
    if (r.kind === "multiplier" && (r.value < 1.05 || r.value > 20)) ctx.addIssue({ code: "custom", message: "Use a multiplier from 1.05 to 20, like 2.5." });
    if (r.kind === "fixed" && (!Number.isInteger(r.value) || r.value < 1 || r.value > 1_000_000)) ctx.addIssue({ code: "custom", message: "Enter how much to add on top of cost, like 10.00." });
  });

export async function setPricingRule(db: Db, shopId: string, input: z.input<typeof ruleInput>) {
  const parsed = ruleInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const rule = { ...parsed.data, compareAtPercent: parsed.data.compareAtPercent || null };
  await db.update(schema.shops).set({ pricingRule: rule, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return rule;
}

export type RepriceRow = {
  productId: string;
  product: string;
  variantId: string;
  variant: string;
  costMinor: number;
  priceMinor: number;
  newPriceMinor: number;
  compareAtMinor: number | null;
  newCompareAtMinor: number | null;
};

/** Every option with a known supplier cost whose price or "was" price the rule would change. */
export async function previewRepricing(db: Db, shop: Shop, rule: PricingRule = pricingRuleOf(shop)) {
  const products = await db.query.products.findMany({
    where: and(eq(schema.products.shopId, shop.id), ne(schema.products.status, "archived"), eq(schema.products.giftCard, false)),
  });
  const variants = products.length ? await db.query.variants.findMany({ where: inArray(schema.variants.productId, products.map((p) => p.id)) }) : [];
  const rows: RepriceRow[] = [];
  let noCost = 0;
  for (const v of variants) {
    if (v.costMinor == null) {
      noCost++;
      continue;
    }
    const p = products.find((x) => x.id === v.productId)!;
    const newPriceMinor = priceFromCost(v.costMinor, rule);
    const newCompareAtMinor = compareAtFor(newPriceMinor, rule);
    if (newPriceMinor === v.priceMinor && newCompareAtMinor === v.compareAtMinor) continue;
    rows.push({
      productId: p.id, product: p.title, variantId: v.id, variant: v.title, costMinor: v.costMinor,
      priceMinor: v.priceMinor, newPriceMinor, compareAtMinor: v.compareAtMinor, newCompareAtMinor,
    });
  }
  rows.sort((a, b) => a.product.localeCompare(b.product) || a.variant.localeCompare(b.variant));
  return { rows, noCost, products: new Set(rows.map((r) => r.productId)).size };
}

/** Applies the store's rule to every product, or to the ones listed. */
export async function applyRepricing(db: Db, shop: Shop, productIds?: string[]) {
  const { rows } = await previewRepricing(db, shop);
  const chosen = productIds ? rows.filter((r) => productIds.includes(r.productId)) : rows;
  if (!chosen.length) throw new UserError("Nothing to change: prices already follow your rule.");
  await db.transaction(async (tx) => {
    for (const r of chosen) {
      await tx.update(schema.variants).set({ priceMinor: r.newPriceMinor, compareAtMinor: r.newCompareAtMinor }).where(eq(schema.variants.id, r.variantId));
    }
    await tx.update(schema.products).set({ updatedAt: new Date() }).where(inArray(schema.products.id, [...new Set(chosen.map((r) => r.productId))]));
  });
  return { variants: chosen.length, products: new Set(chosen.map((r) => r.productId)).size };
}
