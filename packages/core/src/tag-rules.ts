// Tag customers automatically. A rule gives a tag to every customer who matches it ("spent $200 or
// more" → vip, "no order in 90 days" → lapsed) and takes it off when they stop matching, so the
// tag can be trusted for a campaign audience or the customer list filter. Rules run when an order
// is paid, when a rule is added or removed, and on the scheduled job (for refunds and lapsing).
// A tag the merchant typed by hand is theirs: a rule never removes it.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { MAX_TAGS, normalizeTags } from "./customers";
import { NotFoundError, UserError } from "./errors";
import { formatMoney } from "./money";

type Rule = typeof schema.customerTagRules.$inferSelect;
type Kind = Rule["kind"];

export const MAX_TAG_RULES = 20;
const DAY = 86_400_000;
const PLACED = sql`('paid', 'partially_refunded', 'refunded')`;

export function describeTagRule(rule: Pick<Rule, "kind" | "threshold">, currency: string, productTitle?: string | null) {
  switch (rule.kind) {
    case "spent":
      return `Spent ${formatMoney(rule.threshold, currency)} or more`;
    case "orders":
      return rule.threshold === 1 ? "Placed an order" : `Placed ${rule.threshold} or more orders`;
    case "bought":
      return productTitle ? `Bought ${productTitle}` : "Bought a product that's gone";
    case "lapsed":
      return `No order in ${rule.threshold} days`;
  }
}

const ruleInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("spent"), tag: z.string(), threshold: z.number().int().min(1, "Enter an amount above zero.").max(100_000_000, "That amount is too big.") }),
  z.object({ kind: z.literal("orders"), tag: z.string(), threshold: z.number().int().min(1, "Enter at least 1 order.").max(1000, "Up to 1,000 orders.") }),
  z.object({ kind: z.literal("bought"), tag: z.string(), productId: z.string() }),
  z.object({ kind: z.literal("lapsed"), tag: z.string(), threshold: z.number().int().min(7, "Pick at least 7 days.").max(1000, "Up to 1,000 days.") }),
]);
export type TagRuleInput = z.input<typeof ruleInput>;

/** Adds a rule and tags the customers who already match. */
export async function createTagRule(db: Db, shopId: string, input: TagRuleInput, opts: { apply?: boolean; now?: Date } = {}) {
  const parsed = ruleInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const v = parsed.data;
  const [tag, ...more] = normalizeTags(v.tag);
  if (!tag) throw new UserError("Enter the tag to give, like vip.");
  if (more.length) throw new UserError("A rule gives one tag. Leave out the comma.");

  let productId: string | null = null;
  if (v.kind === "bought") {
    const product = /^[0-9a-f-]{36}$/i.test(v.productId)
      ? await db.query.products.findFirst({ where: and(eq(schema.products.id, v.productId), eq(schema.products.shopId, shopId)), columns: { id: true } })
      : null;
    if (!product) throw new UserError("Pick the product they bought.");
    productId = product.id;
  }
  const threshold = v.kind === "bought" ? 0 : v.threshold;

  const existing = await db.query.customerTagRules.findMany({ where: eq(schema.customerTagRules.shopId, shopId) });
  if (existing.length >= MAX_TAG_RULES) throw new UserError(`A store can have up to ${MAX_TAG_RULES} tag rules. Remove one first.`);
  if (existing.some((r) => r.tag === tag && r.kind === v.kind && r.threshold === threshold && r.productId === productId)) {
    throw new UserError("That rule is already here.");
  }
  const [rule] = await db.insert(schema.customerTagRules).values({ shopId, tag, kind: v.kind, threshold, productId }).returning();
  const applied = opts.apply === false ? null : await applyTagRules(db, shopId, { now: opts.now });
  return { rule: rule!, applied };
}

/** Removes a rule, and its tag from the customers it tagged (unless another rule still gives it). */
export async function deleteTagRule(db: Db, shopId: string, ruleId: string, opts: { now?: Date } = {}) {
  if (!z.string().uuid().safeParse(ruleId).success) throw new NotFoundError("Tag rule");
  const [rule] = await db
    .delete(schema.customerTagRules)
    .where(and(eq(schema.customerTagRules.id, ruleId), eq(schema.customerTagRules.shopId, shopId)))
    .returning();
  if (!rule) throw new NotFoundError("Tag rule");
  const applied = await applyTagRules(db, shopId, { now: opts.now });
  return { rule, applied };
}

/** The store's rules, with how many customers have each tag from a rule right now. */
export async function listTagRules(db: Db, shopId: string) {
  const rules = await db
    .select({ rule: schema.customerTagRules, productTitle: schema.products.title })
    .from(schema.customerTagRules)
    .leftJoin(schema.products, eq(schema.products.id, schema.customerTagRules.productId))
    .where(eq(schema.customerTagRules.shopId, shopId))
    .orderBy(asc(schema.customerTagRules.tag), asc(schema.customerTagRules.createdAt));
  if (!rules.length) return [];
  const counts = await db
    .select({ tag: sql<string>`t.tag`, count: sql<number>`count(*)`.mapWith(Number) })
    .from(sql`${schema.customers}, jsonb_array_elements_text(${schema.customers.autoTags}) as t(tag)`)
    .where(eq(schema.customers.shopId, shopId))
    .groupBy(sql`t.tag`);
  const byTag = new Map(counts.map((c) => [c.tag, c.count]));
  return rules.map((r) => ({ ...r.rule, productTitle: r.productTitle, customers: byTag.get(r.rule.tag) ?? 0 }));
}

type Stats = { orders: number; spentMinor: number; lastOrderAt: Date | null };

function matches(rule: Rule, stats: Stats, bought: Map<string, Set<string>>, email: string, now: Date) {
  switch (rule.kind as Kind) {
    case "spent":
      return stats.spentMinor >= rule.threshold;
    case "orders":
      return stats.orders >= rule.threshold;
    case "bought":
      return !!rule.productId && !!bought.get(rule.productId)?.has(email);
    case "lapsed":
      return !!stats.lastOrderAt && now.getTime() - stats.lastOrderAt.getTime() >= rule.threshold * DAY;
  }
}

/**
 * Brings every customer's rule tags in step with the rules: adds the tags they now match and
 * takes off rule tags they no longer match. Pass an email to look at one customer only.
 */
export async function applyTagRules(db: Db, shopId: string, opts: { email?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const rules = await db.query.customerTagRules.findMany({ where: eq(schema.customerTagRules.shopId, shopId) });
  const rows = await db
    .select({
      id: schema.customers.id,
      email: schema.customers.email,
      tags: schema.customers.tags,
      autoTags: schema.customers.autoTags,
      orders: sql<number>`count(${schema.orders.id}) filter (where ${schema.orders.paymentStatus} in ${PLACED})`.mapWith(Number),
      spentMinor: sql<number>`coalesce(sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor}) filter (where ${schema.orders.paymentStatus} in ${PLACED}), 0)`.mapWith(Number),
      lastOrderAt: sql<Date | null>`max(${schema.orders.paidAt}) filter (where ${schema.orders.paymentStatus} in ${PLACED})`.mapWith((v) => (v ? new Date(v) : null)),
    })
    .from(schema.customers)
    .leftJoin(schema.orders, and(eq(schema.orders.shopId, schema.customers.shopId), eq(schema.orders.email, schema.customers.email)))
    .where(and(eq(schema.customers.shopId, shopId), opts.email ? eq(schema.customers.email, opts.email.trim().toLowerCase()) : undefined))
    .groupBy(schema.customers.id)
    // Only customers a rule could tag, or who carry a rule's tag now.
    .having(sql`count(${schema.orders.id}) > 0 or max(jsonb_array_length(${schema.customers.autoTags})) > 0`);

  const productIds = [...new Set(rules.flatMap((r) => (r.kind === "bought" && r.productId ? [r.productId] : [])))];
  const bought = new Map<string, Set<string>>();
  if (productIds.length && rows.length) {
    const buyers = await db
      .selectDistinct({ productId: schema.variants.productId, email: schema.orders.email })
      .from(schema.orderLines)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
      .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
      .where(
        and(
          eq(schema.orders.shopId, shopId),
          sql`${schema.orders.paymentStatus} in ${PLACED}`,
          inArray(schema.variants.productId, productIds),
          opts.email ? eq(schema.orders.email, opts.email.trim().toLowerCase()) : undefined,
        ),
      );
    for (const b of buyers) {
      if (!bought.has(b.productId)) bought.set(b.productId, new Set());
      bought.get(b.productId)!.add(b.email);
    }
  }

  let tagged = 0;
  let untagged = 0;
  for (const c of rows) {
    const wanted = new Set(rules.filter((r) => matches(r, c, bought, c.email, now)).map((r) => r.tag));
    const dropped = c.autoTags.filter((t) => !wanted.has(t));
    const kept = c.tags.filter((t) => !dropped.includes(t));
    const added: string[] = [];
    for (const t of wanted) {
      if (kept.includes(t) || kept.length + added.length >= MAX_TAGS) continue;
      added.push(t);
    }
    if (!dropped.length && !added.length) continue;
    const autoTags = [...c.autoTags.filter((t) => wanted.has(t)), ...added];
    await db.update(schema.customers).set({ tags: [...kept, ...added], autoTags }).where(eq(schema.customers.id, c.id));
    tagged += added.length;
    untagged += dropped.length;
  }
  return { tagged, untagged };
}

/** After an order is paid: the buyer may now match a rule. */
export async function applyTagRulesForOrder(db: Db, orderId: string) {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId), columns: { shopId: true, email: true } });
  if (!order) return { tagged: 0, untagged: 0 };
  const hasRules = await db.query.customerTagRules.findFirst({ where: eq(schema.customerTagRules.shopId, order.shopId), columns: { id: true } });
  if (!hasRules) return { tagged: 0, untagged: 0 };
  return applyTagRules(db, order.shopId, { email: order.email });
}

/** Scheduled job: refunds lower what customers spent, and time makes them lapse. */
export async function applyAllTagRules(db: Db, now = new Date()) {
  const [withRules, withTags] = await Promise.all([
    db.selectDistinct({ shopId: schema.customerTagRules.shopId }).from(schema.customerTagRules),
    db.selectDistinct({ shopId: schema.customers.shopId }).from(schema.customers).where(sql`jsonb_array_length(${schema.customers.autoTags}) > 0`),
  ]);
  const shops = [...new Set([...withRules, ...withTags].map((r) => r.shopId))];
  let tagged = 0;
  let untagged = 0;
  for (const shopId of shops) {
    const r = await applyTagRules(db, shopId, { now });
    tagged += r.tagged;
    untagged += r.untagged;
  }
  return { shops: shops.length, tagged, untagged };
}
