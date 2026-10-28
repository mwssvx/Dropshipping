// Rules for automatic collections, kept free of the database so the admin editor can show which
// products match while the merchant types.
import type { CollectionCondition, CollectionRules } from "@sf/db";
import { z } from "zod";
import { UserError } from "./errors";
import { parseMoney } from "./money";

export type { CollectionCondition, CollectionRules };

const condition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("title_contains"), text: z.string().trim().min(1, "Enter the word the title should contain.").max(60) }),
  z.object({ kind: z.literal("price_at_least"), minor: z.number().int().min(0, "Prices can't be negative.") }),
  z.object({ kind: z.literal("price_at_most"), minor: z.number().int().min(0, "Prices can't be negative.") }),
  z.object({ kind: z.literal("on_sale") }),
  z.object({ kind: z.literal("in_stock") }),
  z.object({ kind: z.literal("added_within_days"), days: z.number().int().min(1, "Use at least 1 day.").max(365, "Use 365 days or fewer.") }),
  z.object({ kind: z.literal("option_is"), name: z.string().trim().min(1, "Enter the option, like Color.").max(40), value: z.string().trim().min(1, "Enter the option's value, like Red.").max(60) }),
  z.object({ kind: z.literal("tagged"), tag: z.string().trim().toLowerCase().min(1, "Enter the tag, like summer.").max(30, "Tags are up to 30 characters.") }),
]);

export const collectionRulesSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(condition).min(1, "Add at least one condition.").max(10, "Use 10 conditions or fewer."),
  sort: z.enum(["newest", "price_asc", "price_desc", "title"]).default("newest"),
});

/** What a rule needs to know about a product. */
export type RuleProduct = {
  title: string;
  tags?: string[];
  createdAt: Date | string;
  variants: { priceMinor: number; compareAtMinor: number | null; stock: number | null; options?: Record<string, string> | null }[];
};

const lowestPrice = (p: RuleProduct) => (p.variants.length ? Math.min(...p.variants.map((v) => v.priceMinor)) : 0);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function meetsCondition(p: RuleProduct, c: CollectionCondition, now: Date) {
  switch (c.kind) {
    case "title_contains":
      return p.title.toLowerCase().includes(c.text.trim().toLowerCase());
    case "price_at_least":
      return lowestPrice(p) >= c.minor;
    case "price_at_most":
      return lowestPrice(p) <= c.minor;
    case "on_sale":
      return p.variants.some((v) => v.compareAtMinor !== null && v.compareAtMinor > v.priceMinor);
    case "in_stock":
      return p.variants.some((v) => v.stock === null || v.stock > 0);
    case "added_within_days":
      return now.getTime() - new Date(p.createdAt).getTime() <= c.days * 86_400_000;
    case "option_is":
      // Any option with that name and value, in any of the product's variants ("Color: Red").
      return p.variants.some((v) => Object.entries(v.options ?? {}).some(([k, val]) => same(k, c.name) && same(val, c.value)));
    case "tagged":
      return (p.tags ?? []).some((t) => same(t, c.tag));
  }
}

export function matchesRules(p: RuleProduct, rules: CollectionRules, now = new Date()) {
  if (!rules.conditions.length) return false;
  return rules.match === "any" ? rules.conditions.some((c) => meetsCondition(p, c, now)) : rules.conditions.every((c) => meetsCondition(p, c, now));
}

/** The products that match, in the collection's order. */
export function applyRules<P extends RuleProduct>(products: P[], rules: CollectionRules, now = new Date()): P[] {
  const hits = products.filter((p) => matchesRules(p, rules, now));
  const by: Record<CollectionRules["sort"], (a: P, b: P) => number> = {
    newest: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    price_asc: (a, b) => lowestPrice(a) - lowestPrice(b),
    price_desc: (a, b) => lowestPrice(b) - lowestPrice(a),
    title: (a, b) => a.title.localeCompare(b.title),
  };
  return hits.sort((a, b) => by[rules.sort](a, b) || a.title.localeCompare(b.title));
}

/** One line per condition for the admin list, e.g. "Price at most $30.00". */
export function describeCondition(c: CollectionCondition, money: (minor: number) => string) {
  switch (c.kind) {
    case "title_contains":
      return `Title contains "${c.text}"`;
    case "price_at_least":
      return `Price at least ${money(c.minor)}`;
    case "price_at_most":
      return `Price at most ${money(c.minor)}`;
    case "on_sale":
      return "Has a compare-at price (on sale)";
    case "in_stock":
      return "In stock";
    case "added_within_days":
      return `Added in the last ${c.days} ${c.days === 1 ? "day" : "days"}`;
    case "option_is":
      return `${c.name} is ${c.value}`;
    case "tagged":
      return `Tagged "${c.tag}"`;
  }
}

/**
 * Rules as typed in the admin (prices as text, like "30.00"), checked and turned into rules.
 * A message names the condition that needs fixing.
 */
export function rulesFromForm(json: string): CollectionRules {
  let raw: { match?: string; sort?: string; conditions?: Record<string, string>[] };
  try {
    raw = JSON.parse(json);
  } catch {
    throw new UserError("Add at least one condition.");
  }
  const conditions = (raw.conditions ?? []).map((d, i) => {
    if (d.kind === "price_at_least" || d.kind === "price_at_most") {
      try {
        return { kind: d.kind, minor: parseMoney(d.price ?? "") };
      } catch {
        throw new UserError(`Condition ${i + 1}: enter a price like 30.00.`);
      }
    }
    if (d.kind === "added_within_days") {
      if (!/^\d+$/.test((d.days ?? "").trim())) throw new UserError(`Condition ${i + 1}: enter a number of days.`);
      return { kind: d.kind, days: Number(d.days) };
    }
    if (d.kind === "title_contains") return { kind: d.kind, text: d.text ?? "" };
    if (d.kind === "option_is") return { kind: d.kind, name: d.name ?? "", value: d.value ?? "" };
    if (d.kind === "tagged") return { kind: d.kind, tag: d.tag ?? "" };
    return { kind: d.kind };
  });
  const parsed = collectionRulesSchema.safeParse({ match: raw.match, sort: raw.sort, conditions });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const at = issue.path[0] === "conditions" && typeof issue.path[1] === "number" ? `Condition ${issue.path[1] + 1}: ` : "";
    throw new UserError(at ? at + issue.message.charAt(0).toLowerCase() + issue.message.slice(1) : issue.message);
  }
  return parsed.data;
}
