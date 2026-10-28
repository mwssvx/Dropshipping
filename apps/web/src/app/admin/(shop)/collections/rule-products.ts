import type { listProducts } from "@sf/core";
import type { RuleProductView } from "./RulesEditor";

/** Just what the collection editor needs about each product, to keep the page small. */
export function ruleProducts(products: Awaited<ReturnType<typeof listProducts>>): RuleProductView[] {
  return products.map((p) => ({
    id: p.id,
    title: p.title,
    imageUrl: p.imageUrl,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    tags: p.tags,
    variants: p.variants.map((v) => ({ priceMinor: v.priceMinor, compareAtMinor: v.compareAtMinor, stock: v.stock, options: v.options ?? {} })),
  }));
}
