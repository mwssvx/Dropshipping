import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { schema, type AgentName } from "@sf/db";
import { UserError } from "../errors";
import { PROBLEM_FIXES, retryOrder, routeOrder, sendOrderEmail } from "../fulfillment";
import { formatMoney } from "../money";
import { estimateProcessingFee, planAdvice, platformFeeFor, PLANS } from "../plans";
import { moneySummary } from "../payouts";
import { refundOrder } from "../refunds";
import { openNotices } from "../trust";
import { describeShipping } from "../shipping";
import { setPricesIncludeTax } from "../tax";
import { createPost } from "../blog";
import type { ProblemCode } from "../suppliers";
import { AUTO, blocked, needsOk, untrusted, type Decision, type RunScope } from "./context";
import { addMessage, BUYER_TOPICS, discardDrafts, sendBuyerMessage, setConversationStatus, type BuyerTopic } from "./conversations";

export type AgentTool<I = any> = {
  name: string;
  description: string;
  input: z.ZodType<I>;
  /** Reads always run. Changes go through `policy`. */
  kind: "read" | "change";
  policy?: (input: I, run: RunScope) => Promise<Decision> | Decision;
  /** One line for the approvals list and the activity log. */
  summary: (input: I, run: RunScope) => Promise<string> | string;
  /** Called when a change has to wait: lets a tool leave a draft and remember it in the input. */
  propose?: (input: I, run: RunScope) => Promise<I>;
  run: (input: I, run: RunScope) => Promise<unknown>;
};

const tool = <I>(t: AgentTool<I>) => t;
const money = (run: RunScope, minor: number) => formatMoney(minor, run.shop.currency);
const DAY = 86_400_000;

/** A live price change bigger than this needs the merchant's OK. */
export const PRICE_CHANGE_LIMIT = 0.1;

async function runOrder(run: RunScope) {
  if (!run.orderId) throw new UserError("This run isn't about an order.");
  const order = await run.ctx.db.query.orders.findFirst({ where: and(eq(schema.orders.id, run.orderId), eq(schema.orders.shopId, run.shop.id)) });
  if (!order) throw new UserError("Order not found.");
  return order;
}

async function orderByNumber(run: RunScope, number: number) {
  const order = await run.ctx.db.query.orders.findFirst({ where: and(eq(schema.orders.shopId, run.shop.id), eq(schema.orders.number, number)) });
  if (!order) throw new UserError(`There's no order #${number} in this store.`);
  return order;
}

/** The facts about an order an agent needs, without card or payment details. */
async function orderFacts(run: RunScope, order: typeof schema.orders.$inferSelect) {
  const { db } = run.ctx;
  const lines = await db
    .select({ line: schema.orderLines, variant: schema.variants })
    .from(schema.orderLines)
    .leftJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .where(eq(schema.orderLines.orderId, order.id));
  const parcels = await db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, order.id) });
  const days = lines.map((l) => l.variant).filter((v) => v?.shipDaysMax);
  const shipWindow = days.length
    ? `${Math.min(...days.map((v) => v!.shipDaysMin ?? v!.shipDaysMax!))}-${Math.max(...days.map((v) => v!.shipDaysMax!))} days after the supplier sends it`
    : null;
  return {
    order_number: order.number,
    placed_on: order.createdAt.toISOString().slice(0, 10),
    buyer_first_name: order.shippingAddress.name.split(/\s+/)[0],
    ship_to_country: order.shippingAddress.country,
    items: lines.map(({ line }) => ({ order_line_id: line.id, title: line.title, quantity: line.quantity, unit_price: money(run, line.unitPriceMinor) })),
    total: money(run, order.totalMinor),
    payment: order.paymentStatus,
    refunded: order.refundedMinor ? money(run, order.refundedMinor) : null,
    delivery: order.fulfillmentStatus,
    usual_delivery_time: shipWindow,
    parcels: parcels
      .filter((p) => p.status !== "cancelled")
      .map((p) => ({
        status: p.status,
        carrier: p.carrier,
        tracking_number: p.trackingNumber,
        tracking_link: p.trackingUrl,
        sent_to_supplier_on: p.placedAt?.toISOString().slice(0, 10) ?? null,
        shipped_on: p.shippedAt?.toISOString().slice(0, 10) ?? null,
        delivered_on: p.deliveredAt?.toISOString().slice(0, 10) ?? null,
        problem: p.problemCode ? { code: p.problemCode, supplier_said: untrusted("supplier", p.problemMessage ?? "") } : null,
      })),
  };
}

/* ───────────── Listing writer: drafts only, never publishes ───────────── */

const listingTools = [
  tool({
    name: "get_product",
    kind: "read",
    description: "Read the product you're writing for: current title and description, prices, and what the supplier says about it.",
    input: z.object({}),
    summary: () => "Read the product",
    async run(_, run) {
      const { db, suppliers } = run.ctx;
      const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, run.productId!), eq(schema.products.shopId, run.shop.id)) });
      if (!product) throw new UserError("Product not found.");
      const variants = await db.query.variants.findMany({ where: eq(schema.variants.productId, product.id), orderBy: asc(schema.variants.position) });
      let supplier: unknown = null;
      if (product.sourceUrl) {
        try {
          const p = await suppliers.forUrl(product.sourceUrl).getProductFromUrl(product.sourceUrl);
          supplier = { title: untrusted("supplier", p.title), description: untrusted("supplier", p.description.slice(0, 4000)), variants: p.variants.map((v) => v.title) };
        } catch {
          supplier = "The supplier listing couldn't be read right now.";
        }
      }
      return {
        status: product.status,
        title: product.title,
        description: product.descriptionHtml,
        options: variants.map((v) => ({ name: v.title, price: money(run, v.priceMinor), ships_in_days: v.shipDaysMax ? `${v.shipDaysMin}-${v.shipDaysMax}` : null })),
        supplier_listing: supplier,
        store_country: run.shop.country,
      };
    },
  }),
  tool({
    name: "save_listing",
    kind: "change",
    description:
      "Save a new title and description. Plain text only: short paragraphs, and lines starting with '• ' for bullet points. Only claim what the product data supports. Products that are already on sale wait for the merchant's OK.",
    input: z.object({
      title: z.string().min(3).max(120).describe("Clear product name buyers would search for, no ALL CAPS, no emoji, no supplier junk words."),
      description: z.string().min(40).max(3000).describe("Plain text. A short opening paragraph, then 3 to 6 bullet lines starting with '• '."),
    }),
    policy: async (_, run) => {
      const p = await run.ctx.db.query.products.findFirst({ where: eq(schema.products.id, run.productId!), columns: { status: true } });
      return p?.status === "draft" ? AUTO : needsOk("This product is on sale, so you see the new wording before buyers do.");
    },
    summary: (i) => `New title and description: “${i.title}”`,
    async run(i, run) {
      if (/<[a-z/][^>]*>/i.test(i.description)) throw new UserError("The description must be plain text, without HTML tags.");
      const [p] = await run.ctx.db
        .update(schema.products)
        .set({ title: i.title.trim(), descriptionHtml: i.description.trim(), aiGenerated: true, updatedAt: new Date() })
        .where(and(eq(schema.products.id, run.productId!), eq(schema.products.shopId, run.shop.id)))
        .returning({ id: schema.products.id });
      if (!p) throw new UserError("Product not found.");
      return { saved: true };
    },
  }),
];

/* ───────────── Blog writer: saves drafts, the merchant publishes ───────────── */

const writerTools = [
  tool({
    name: "read_products",
    kind: "read",
    description: "Read products from the store: title, price and description. Pass product_ids for the ones the merchant picked, or none for up to 30 products on sale.",
    input: z.object({ product_ids: z.array(z.string()).max(8).optional() }),
    summary: () => "Read the store's products",
    async run(i, run) {
      const { db } = run.ctx;
      const ids = (i.product_ids ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      const rows = await db.query.products.findMany({
        where: and(eq(schema.products.shopId, run.shop.id), eq(schema.products.status, "active"), ids.length ? inArray(schema.products.id, ids) : undefined),
        orderBy: desc(schema.products.createdAt),
        limit: 30,
      });
      const variants = rows.length ? await db.query.variants.findMany({ where: inArray(schema.variants.productId, rows.map((r) => r.id)) }) : [];
      return {
        store: { name: run.shop.name, country: run.shop.country },
        products: rows.map((p) => ({
          id: p.id,
          title: p.title,
          price_from: money(run, Math.min(...variants.filter((v) => v.productId === p.id).map((v) => v.priceMinor))),
          description: untrusted("product", p.descriptionHtml.slice(0, 1500)),
        })),
      };
    },
  }),
  tool({
    name: "save_post_draft",
    kind: "change",
    description:
      "Save the blog post as a draft. The merchant reads and publishes it. Plain text only: blank lines between paragraphs, '## ' at the start of a line for a subheading, '• ' for a bullet.",
    input: z.object({
      title: z.string().min(5).max(140).describe("A title people would search for, not clickbait."),
      excerpt: z.string().min(20).max(300).describe("One or two sentences for the blog list and search engines."),
      body: z.string().min(300).max(20_000).describe("The post, plain text, about 400 to 900 words."),
      product_ids: z.array(z.string()).max(8).describe("Products the post features, shown under it with a link."),
    }),
    policy: () => AUTO,
    summary: (i) => `Drafted a blog post: “${i.title}”`,
    async run(i, run) {
      const post = await createPost(
        run.ctx.db,
        run.shop.id,
        { title: i.title, excerpt: i.excerpt, body: i.body, productIds: i.product_ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)) },
        { aiGenerated: true },
      );
      return { saved: true, post_id: post.id };
    },
  }),
];

/* ───────────── Merchant assistant: reads freely, changes need an OK ───────────── */

const SETTINGS = {
  prices_include_tax: "Whether prices include tax (true or false)",
  ai_auto_pause: "Let the margin agent pause money-losing products on its own (true or false)",
  ai_monthly_budget: "Monthly AI budget in US dollars, for example 5",
} as const;

const assistantTools = [
  tool({
    name: "read_store",
    kind: "read",
    description: "Overview of the store: plan, products, orders and money for the last 30 days, problem orders, open notices, AI budget.",
    input: z.object({}),
    summary: () => "Read the store overview",
    async run(_, run) {
      const { db } = run.ctx;
      const [money30, advice, notices, counts, problems] = await Promise.all([
        moneySummary(db, run.shop),
        planAdvice(db, run.shop),
        openNotices(db, run.shop.id),
        db.select({ status: schema.products.status, n: sql<number>`count(*)::int` }).from(schema.products).where(eq(schema.products.shopId, run.shop.id)).groupBy(schema.products.status),
        db.select({ n: sql<number>`count(*)::int` }).from(schema.orders).where(and(eq(schema.orders.shopId, run.shop.id), eq(schema.orders.fulfillmentStatus, "problem"))),
      ]);
      const m = money30.last30;
      return {
        store: run.shop.name,
        status: run.shop.status,
        plan: PLANS[run.shop.plan].name,
        cheaper_plan: advice.best ? { plan: PLANS[advice.best.plan].name, saves_per_month: money(run, advice.best.saveMinor) } : null,
        products: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
        last_30_days: {
          orders: m.orders,
          sales: money(run, m.salesMinor),
          refunds: money(run, m.refundsMinor),
          profit_after_costs_and_fees: money(run, m.profitMinor),
        },
        balance: { ready_to_pay_out: money(run, money30.availableMinor), clearing: money(run, money30.pendingMinor) },
        problem_orders: Number(problems[0]?.n ?? 0),
        open_notices: notices.map((n) => ({ kind: n.kind, about: n.title, fix_by: n.dueBy?.toISOString().slice(0, 10) ?? null })),
        prices_include_tax: run.shop.pricesIncludeTax,
      };
    },
  }),
  tool({
    name: "find_orders",
    kind: "read",
    description: "List recent orders, newest first, optionally only those with a delivery problem or not yet sent, or matching a buyer's email or name.",
    input: z.object({
      filter: z.enum(["all", "problem", "unfulfilled", "shipped", "refunded"]).describe("Which orders"),
      search: z.string().max(100).optional().describe("Part of the buyer's email or name"),
    }),
    summary: (i) => `Looked up ${i.filter === "all" ? "recent" : i.filter} orders`,
    async run(i, run) {
      const o = schema.orders;
      const where = and(
        eq(o.shopId, run.shop.id),
        i.filter === "problem" ? eq(o.fulfillmentStatus, "problem") : undefined,
        i.filter === "unfulfilled" ? and(eq(o.paymentStatus, "paid"), eq(o.fulfillmentStatus, "unfulfilled")) : undefined,
        i.filter === "shipped" ? inArray(o.fulfillmentStatus, ["shipped", "delivered", "partially_shipped"]) : undefined,
        i.filter === "refunded" ? inArray(o.paymentStatus, ["refunded", "partially_refunded"]) : undefined,
        i.search ? or(ilike(o.email, `%${i.search}%`), sql`${o.shippingAddress}->>'name' ilike ${`%${i.search}%`}`) : undefined,
        sql`${o.paymentStatus} <> 'pending'`,
      );
      const rows = await run.ctx.db.query.orders.findMany({ where, orderBy: desc(o.createdAt), limit: 10 });
      return rows.map((r) => ({
        order_number: r.number,
        placed_on: r.createdAt.toISOString().slice(0, 10),
        buyer: r.shippingAddress.name,
        total: money(run, r.totalMinor),
        payment: r.paymentStatus,
        delivery: r.fulfillmentStatus,
      }));
    },
  }),
  tool({
    name: "read_order",
    kind: "read",
    description: "Everything about one order: items, payment, delivery status, tracking and any supplier problem.",
    input: z.object({ order_number: z.number().int().positive() }),
    summary: (i) => `Read order #${i.order_number}`,
    async run(i, run) {
      const order = await orderByNumber(run, i.order_number);
      return { ...(await orderFacts(run, order)), buyer_email: order.email, how_to_fix: problemHint(await problemCode(run, order.id)) };
    },
  }),
  tool({
    name: "find_products",
    kind: "read",
    description: "List products with price, supplier cost and margin per sale after fees.",
    input: z.object({ search: z.string().max(100).optional() }),
    summary: (i) => (i.search ? `Looked up products matching “${i.search}”` : "Looked up products"),
    async run(i, run) {
      return (await productMargins(run, i.search)).slice(0, 20);
    },
  }),
  tool({
    name: "change_setting",
    kind: "change",
    description: `Change a store setting. Settings: ${Object.entries(SETTINGS).map(([k, v]) => `${k}: ${v}`).join("; ")}. Waits for the merchant's OK.`,
    input: z.object({ setting: z.enum(Object.keys(SETTINGS) as [keyof typeof SETTINGS]), value: z.string().max(20) }),
    policy: (i) => {
      if (i.setting !== "ai_monthly_budget" && !["true", "false"].includes(i.value)) return blocked("That setting takes true or false.");
      return needsOk("Settings only change with your OK.");
    },
    summary: (i) => settingSummary(i.setting, i.value),
    async run(i, run) {
      const { db } = run.ctx;
      if (i.setting === "prices_include_tax") await setPricesIncludeTax(db, run.shop.id, i.value === "true");
      if (i.setting === "ai_auto_pause") await db.update(schema.shops).set({ aiAutoPause: i.value === "true" }).where(eq(schema.shops.id, run.shop.id));
      if (i.setting === "ai_monthly_budget") await setAiSettings(db, run.shop, { budgetMinor: Math.round(Number(i.value) * 100) });
      return { changed: true };
    },
  }),
  tool({
    name: "resend_email",
    kind: "change",
    description: "Send an order email to the buyer again, for example when they say they never got it. Waits for the merchant's OK.",
    input: z.object({ order_number: z.number().int().positive(), email: z.enum(["order_confirmation", "shipping_update"]) }),
    policy: () => needsOk("It emails a customer."),
    summary: (i) => `Resend the ${i.email === "order_confirmation" ? "order confirmation" : "shipping update"} for order #${i.order_number}`,
    async run(i, run) {
      const order = await orderByNumber(run, i.order_number);
      if (i.email === "shipping_update" && !["shipped", "partially_shipped", "delivered"].includes(order.fulfillmentStatus)) {
        throw new UserError(`Order #${order.number} hasn't shipped yet, so there's no shipping update to send.`);
      }
      return sendOrderEmail(run.ctx, order.id, i.email, `resend-${Date.now().toString(36)}`);
    },
  }),
  tool({
    name: "open_ticket",
    kind: "change",
    description:
      "Ask the platform's human support team for help: payouts, account holds, store notices, bugs, or anything you can't do. They reply in this chat.",
    input: z.object({ subject: z.string().min(5).max(120), details: z.string().min(20).max(3000) }),
    policy: () => AUTO,
    summary: (i) => `Asked our support team: “${i.subject}”`,
    async run(i, run) {
      const [c] = await run.ctx.db
        .insert(schema.conversations)
        .values({ shopId: run.shop.id, kind: "ticket", subject: i.subject, status: "escalated", statusReason: "Opened by the assistant" })
        .returning();
      await addMessage(run.ctx.db, c!.id, { author: "agent", body: i.details });
      return { ticket_opened: true, note: "Our team usually replies within one working day, here in this chat." };
    },
  }),
];

function settingSummary(setting: keyof typeof SETTINGS, value: string) {
  if (setting === "prices_include_tax") return value === "true" ? "Show prices with tax included" : "Show prices with tax added at checkout";
  if (setting === "ai_auto_pause") return value === "true" ? "Let the margin agent pause money-losing products" : "Ask before pausing money-losing products";
  return `Set the monthly AI budget to $${Number(value).toFixed(2)}`;
}

async function problemCode(run: RunScope, orderId: string) {
  const f = await run.ctx.db.query.fulfillments.findFirst({
    where: and(eq(schema.fulfillments.orderId, orderId), sql`${schema.fulfillments.problemCode} is not null`),
  });
  return (f?.problemCode as ProblemCode | null) ?? null;
}
const problemHint = (code: ProblemCode | null) => (code ? PROBLEM_FIXES[code] : null);

/** Price, cost and what's left per sale after the supplier, card fee and our fee. */
async function productMargins(run: RunScope, search?: string) {
  const rows = await run.ctx.db
    .select({ product: schema.products, variant: schema.variants })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.products.shopId, run.shop.id), search ? ilike(schema.products.title, `%${search}%`) : undefined))
    .orderBy(asc(schema.products.title), asc(schema.variants.position));
  return rows.map(({ product, variant }) => {
    const fees = estimateProcessingFee(variant.priceMinor) + platformFeeFor(run.shop.plan, variant.priceMinor);
    const left = variant.costMinor === null ? null : variant.priceMinor - variant.costMinor - fees;
    return {
      product_id: product.id,
      variant_id: variant.id,
      product: product.title,
      option: variant.title,
      on_sale: product.status === "active",
      price: money(run, variant.priceMinor),
      price_minor: variant.priceMinor,
      supplier_cost_minor: variant.costMinor,
      fees_minor: fees,
      left_per_sale_minor: left,
      margin_pct: left === null || !variant.priceMinor ? null : Math.round((left / variant.priceMinor) * 100),
    };
  });
}

/* ───────────── Buyer support ───────────── */

/** Words that promise the buyer money or goods; those replies always wait for the merchant. */
const PROMISE = /\b(refund|money back|reimburs|compensat|discount|coupon|voucher|free (replacement|item|gift)|credit)\w*/i;

/**
 * Whether a reply promises the buyer money. Sentences copied from the store's own published
 * pages (quoting the returns policy) don't count; anything else that mentions a refund does.
 */
async function promisesMoney(run: RunScope, message: string) {
  if (!PROMISE.test(message)) return false;
  const pages = await run.ctx.db.query.pages.findMany({ where: and(eq(schema.pages.shopId, run.shop.id), eq(schema.pages.published, true)), columns: { body: true } });
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const published = norm(pages.map((p) => p.body).join(" "));
  const sentences = message.split(/(?<=[.!?])\s+|\n+/).map(norm).filter(Boolean);
  return sentences.some((s) => PROMISE.test(s) && !published.includes(s.replace(/^[^a-z0-9]+/, "")));
}

const buyerTools = [
  tool({
    name: "read_order",
    kind: "read",
    description: "The buyer's order: items, payment, delivery status, tracking and usual delivery time.",
    input: z.object({}),
    summary: () => "Read the buyer's order",
    async run(_, run) {
      return orderFacts(run, await runOrder(run));
    },
  }),
  tool({
    name: "read_store_policies",
    kind: "read",
    description: "The store's published pages (returns, shipping, FAQ) and its shipping prices.",
    input: z.object({}),
    summary: () => "Read the store's policies",
    async run(_, run) {
      const pages = await run.ctx.db.query.pages.findMany({ where: and(eq(schema.pages.shopId, run.shop.id), eq(schema.pages.published, true)) });
      return {
        shipping_prices: await describeShipping(run.ctx.db, run.shop),
        pages: pages.map((p) => ({ title: p.title, text: p.body.slice(0, 3000) })),
        note: pages.length ? null : "The store hasn't published a returns or shipping page.",
      };
    },
  }),
  tool({
    name: "send_reply",
    kind: "change",
    description:
      "Reply to the buyer by email and on their order page. Write as the store, warm and short, using only facts from the tools. Call once per buyer message. Depending on the merchant's settings it's sent straight away or saved as a draft for them to check.",
    input: z.object({
      topic: z.enum(Object.keys(BUYER_TOPICS) as [BuyerTopic]).describe("What the buyer asked about"),
      message: z.string().min(20).max(2000).describe("The reply, plain text, signed with the store's name"),
    }),
    policy: async (i, run) => {
      const c = await run.ctx.db.query.conversations.findFirst({ where: eq(schema.conversations.id, run.conversationId!) });
      if (c?.status === "needs_merchant" || c?.status === "escalated") return needsOk("This conversation was handed to a person.");
      if (await promisesMoney(run, i.message)) return needsOk("The reply mentions a refund, discount or something free.");
      if (!run.shop.aiAutoReplyTopics.includes(i.topic)) return needsOk(`You haven't let the assistant answer “${BUYER_TOPICS[i.topic].toLowerCase()}” questions on its own.`);
      return AUTO;
    },
    summary: (i) => `Reply to the buyer about ${BUYER_TOPICS[i.topic].toLowerCase()}`,
    async propose(i, run) {
      // Leave the reply as a draft in the inbox so the merchant can edit it before it goes.
      const m = await addMessage(run.ctx.db, run.conversationId!, { author: "agent", body: i.message, status: "draft", topic: i.topic });
      await setConversationStatus(run.ctx.db, run.conversationId!, "needs_merchant", "A reply is waiting for your OK");
      return { ...i, message_id: m.id };
    },
    async run(i: { topic: BuyerTopic; message: string; message_id?: string }, run) {
      const id = i.message_id ?? (await addMessage(run.ctx.db, run.conversationId!, { author: "agent", body: i.message, status: "draft", topic: i.topic })).id;
      await discardDrafts(run.ctx.db, run.conversationId!, id);
      return sendBuyerMessage(run.ctx, id, i.message);
    },
  }),
  tool({
    name: "hand_over",
    kind: "change",
    description:
      "Hand the conversation to a person instead of answering. 'merchant' for anything you can't answer from the order and policies, refunds, cancellations, address changes, complaints or an upset buyer. 'platform' only if the buyer says the store is a scam or fraud, or mentions police or a lawyer.",
    input: z.object({ to: z.enum(["merchant", "platform"]), reason: z.string().min(5).max(300) }),
    policy: () => AUTO,
    summary: (i) => (i.to === "platform" ? `Sent to our trust team: ${i.reason}` : `Handed to you: ${i.reason}`),
    async run(i, run) {
      await setConversationStatus(run.ctx.db, run.conversationId!, i.to === "platform" ? "escalated" : "needs_merchant", i.reason);
      return { handed_over: true, note: "Don't reply to the buyer yourself now." };
    },
  }),
];

/* ───────────── Fulfilment: fixes problem orders ───────────── */

const fulfilmentTools = [
  tool({
    name: "read_problem_order",
    kind: "read",
    description: "The problem order: what failed at the supplier, the suggested fix, and other options of the same product with stock and cost.",
    input: z.object({}),
    summary: () => "Read the problem order",
    async run(_, run) {
      const order = await runOrder(run);
      const code = await problemCode(run, order.id);
      const lines = await run.ctx.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
      const alternatives = [];
      for (const l of lines) {
        if (!l.variantId) continue;
        const v = await run.ctx.db.query.variants.findFirst({ where: eq(schema.variants.id, l.variantId) });
        if (!v) continue;
        const siblings = await run.ctx.db.query.variants.findMany({ where: eq(schema.variants.productId, v.productId), orderBy: asc(schema.variants.position) });
        alternatives.push({
          order_line_id: l.id,
          ordered: l.title,
          options: siblings
            .filter((s) => s.id !== v.id)
            .map((s) => ({ variant_id: s.id, name: s.title, price: money(run, s.priceMinor), supplier_cost_minor: s.costMinor, stock: s.stock, same_price_and_cost: s.priceMinor === v.priceMinor && s.costMinor === v.costMinor })),
        });
      }
      return {
        ...(await orderFacts(run, order)),
        problem: code,
        suggested_fix: problemHint(code),
        refundable: money(run, order.totalMinor - order.refundedMinor),
        refundable_minor: order.totalMinor - order.refundedMinor,
        alternatives,
      };
    },
  }),
  tool({
    name: "retry_supplier_order",
    kind: "change",
    description: "Send the order to the supplier again. Worth it when the supplier didn't answer or had a temporary error; pointless for out of stock.",
    input: z.object({}),
    policy: () => AUTO,
    summary: () => "Sent the order to the supplier again",
    async run(_, run) {
      const order = await runOrder(run);
      try {
        await retryOrder(run.ctx, run.shop.id, order.id);
        return { fixed: true };
      } catch (e) {
        if (e instanceof UserError) return { fixed: false, supplier_said: untrusted("supplier", e.message) };
        throw e;
      }
    },
  }),
  tool({
    name: "swap_variant",
    kind: "change",
    description:
      "Replace the ordered option with another option of the same product and send the order to the supplier again. Runs straight away only for an identical item (same name, price and cost, e.g. another warehouse); a different size or colour waits for the merchant, who should check with the buyer.",
    input: z.object({ order_line_id: z.string().uuid(), variant_id: z.string().uuid() }),
    policy: async (i, run) => {
      const pair = await swapPair(run, i);
      if (!pair.ok) return blocked(pair.error);
      const { from, to } = pair;
      if (to.stock !== null && to.stock < 1) return blocked("That option is out of stock too.");
      if (from.priceMinor !== to.priceMinor || from.costMinor !== to.costMinor) return needsOk("The other option costs a different amount.");
      if (from.title !== to.title) return needsOk("It's a different option from what the buyer chose.");
      return AUTO;
    },
    summary: async (i, run) => {
      const pair = await swapPair(run, i);
      return !pair.ok ? "Swap an item" : `Send “${pair.to.title}” instead of “${pair.from.title}” and retry the supplier`;
    },
    async run(i, run) {
      const pair = await swapPair(run, i);
      if (!pair.ok) throw new UserError(pair.error);
      const { line, to, product } = pair;
      await run.ctx.db
        .update(schema.orderLines)
        .set({ variantId: to.id, title: `${product.title}${to.title === "Default" ? "" : ` – ${to.title}`}`, unitCostMinor: to.costMinor })
        .where(eq(schema.orderLines.id, line.id));
      const r = await routeOrder(run.ctx, line.orderId);
      return { swapped: true, sent_to_supplier: r.placed > 0, still_failing: r.failed > 0 };
    },
  }),
  tool({
    name: "propose_refund",
    kind: "change",
    description: "Propose refunding the buyer, in full (leave amount out) or in part. Always waits for the merchant's OK because it moves money.",
    input: z.object({ amount_minor: z.number().int().positive().optional(), reason: z.string().min(5).max(300) }),
    policy: async (i, run) => {
      const order = await runOrder(run);
      if (!["paid", "partially_refunded"].includes(order.paymentStatus)) return blocked("This order can't be refunded.");
      if (i.amount_minor && i.amount_minor > order.totalMinor - order.refundedMinor) return blocked("That's more than is left to refund.");
      return needsOk("It moves money.");
    },
    summary: async (i, run) => {
      const order = await runOrder(run);
      const amount = i.amount_minor ?? order.totalMinor - order.refundedMinor;
      return `Refund ${money(run, amount)} on order #${order.number}: ${i.reason}`;
    },
    async run(i, run) {
      const order = await runOrder(run);
      const { refund } = await refundOrder(run.ctx, run.shop.id, order.id, { amountMinor: i.amount_minor, reason: i.reason });
      return { refunded: money(run, refund.amountMinor) };
    },
  }),
  tool({
    name: "message_buyer",
    kind: "change",
    description: "Draft an email to the buyer about the problem (for example, an apology with what happens next). The merchant checks it before it's sent.",
    input: z.object({ message: z.string().min(20).max(2000) }),
    policy: () => needsOk("It writes to a buyer about a problem."),
    summary: () => "Email the buyer about the problem",
    async propose(i, run) {
      const conversationId = await buyerConversationFor(run);
      const m = await addMessage(run.ctx.db, conversationId, { author: "agent", body: i.message, status: "draft", topic: "order_status" });
      await setConversationStatus(run.ctx.db, conversationId, "needs_merchant", "A message about a problem is waiting for your OK");
      return { ...i, message_id: m.id };
    },
    async run(i: { message: string; message_id?: string }, run) {
      const conversationId = await buyerConversationFor(run);
      const id = i.message_id ?? (await addMessage(run.ctx.db, conversationId, { author: "agent", body: i.message, status: "draft" })).id;
      return sendBuyerMessage(run.ctx, id, i.message);
    },
  }),
];

async function swapPair(run: RunScope, i: { order_line_id: string; variant_id: string }) {
  const { db } = run.ctx;
  const line = await db.query.orderLines.findFirst({ where: eq(schema.orderLines.id, i.order_line_id) });
  if (!line || line.orderId !== run.orderId || !line.variantId) return { ok: false as const, error: "That item isn't part of this order." };
  const from = await db.query.variants.findFirst({ where: eq(schema.variants.id, line.variantId) });
  const to = await db.query.variants.findFirst({ where: eq(schema.variants.id, i.variant_id) });
  if (!from || !to || from.productId !== to.productId || from.id === to.id) return { ok: false as const, error: "You can only swap to another option of the same product." };
  const product = (await db.query.products.findFirst({ where: eq(schema.products.id, to.productId) }))!;
  if (product.shopId !== run.shop.id) return { ok: false as const, error: "That product isn't in this store." };
  return { ok: true as const, line, from, to, product };
}

async function buyerConversationFor(run: RunScope) {
  const order = await runOrder(run);
  await run.ctx.db
    .insert(schema.conversations)
    .values({ shopId: run.shop.id, kind: "buyer", orderId: order.id, email: order.email, subject: `Order #${order.number}` })
    .onConflictDoNothing();
  const c = await run.ctx.db.query.conversations.findFirst({
    where: and(eq(schema.conversations.orderId, order.id), eq(schema.conversations.kind, "buyer")),
  });
  return c!.id;
}

/* ───────────── Margin watch ───────────── */

const marginTools = [
  tool({
    name: "read_costs",
    kind: "read",
    description: "Every product option with its price, the supplier's current cost, fees, and what's left per sale. Costs are refreshed from the supplier first.",
    input: z.object({}),
    summary: () => "Checked supplier costs and margins",
    async run(_, run) {
      const changed = await refreshSupplierCosts(run);
      return { cost_changes: changed, products: await productMargins(run) };
    },
  }),
  tool({
    name: "change_price",
    kind: "change",
    description: `Change an option's price. Changes of more than ${PRICE_CHANGE_LIMIT * 100}% to a product on sale wait for the merchant's OK. Never below the supplier cost.`,
    input: z.object({ variant_id: z.string().uuid(), price_minor: z.number().int().positive(), reason: z.string().min(5).max(300) }),
    policy: async (i, run) => {
      const row = await variantInShop(run, i.variant_id);
      if (!row) return blocked("That option isn't in this store.");
      if (row.variant.costMinor !== null && i.price_minor <= row.variant.costMinor) return blocked("The new price would be at or below the supplier's cost.");
      const change = Math.abs(i.price_minor - row.variant.priceMinor) / Math.max(row.variant.priceMinor, 1);
      if (row.product.status === "active" && change > PRICE_CHANGE_LIMIT) return needsOk(`It changes a live price by ${Math.round(change * 100)}%.`);
      return AUTO;
    },
    summary: async (i, run) => {
      const row = await variantInShop(run, i.variant_id);
      if (!row) return "Change a price";
      const name = row.variant.title === "Default" ? row.product.title : `${row.product.title} (${row.variant.title})`;
      return `Change ${name} from ${money(run, row.variant.priceMinor)} to ${money(run, i.price_minor)}: ${i.reason}`;
    },
    async run(i, run) {
      const row = await variantInShop(run, i.variant_id);
      if (!row) throw new UserError("That option isn't in this store.");
      if (row.variant.costMinor !== null && i.price_minor <= row.variant.costMinor) throw new UserError("The new price would be at or below the supplier's cost.");
      await run.ctx.db.update(schema.variants).set({ priceMinor: i.price_minor }).where(eq(schema.variants.id, row.variant.id));
      return { changed: true };
    },
  }),
  tool({
    name: "pause_product",
    kind: "change",
    description: "Take a product off sale (it goes back to draft). Runs on its own only if the merchant allowed that; otherwise waits for their OK.",
    input: z.object({ product_id: z.string().uuid(), reason: z.string().min(5).max(300) }),
    policy: async (i, run) => {
      const p = await run.ctx.db.query.products.findFirst({ where: and(eq(schema.products.id, i.product_id), eq(schema.products.shopId, run.shop.id)) });
      if (!p) return blocked("That product isn't in this store.");
      if (p.status !== "active") return blocked("That product isn't on sale.");
      return run.shop.aiAutoPause ? AUTO : needsOk("It takes a product off sale.");
    },
    summary: async (i, run) => {
      const p = await run.ctx.db.query.products.findFirst({ where: eq(schema.products.id, i.product_id), columns: { title: true } });
      return `Take “${p?.title ?? "a product"}” off sale: ${i.reason}`;
    },
    async run(i, run) {
      await run.ctx.db
        .update(schema.products)
        .set({ status: "draft", updatedAt: new Date() })
        .where(and(eq(schema.products.id, i.product_id), eq(schema.products.shopId, run.shop.id)));
      return { paused: true };
    },
  }),
];

async function variantInShop(run: RunScope, variantId: string) {
  const [row] = await run.ctx.db
    .select({ variant: schema.variants, product: schema.products })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.variants.id, variantId), eq(schema.products.shopId, run.shop.id)));
  return row ?? null;
}

/** Ask suppliers for today's cost of each imported product and store any change. */
export async function refreshSupplierCosts(run: Pick<RunScope, "ctx" | "shop">) {
  const { db, suppliers } = run.ctx;
  const products = await db.query.products.findMany({
    where: and(eq(schema.products.shopId, run.shop.id), eq(schema.products.status, "active"), sql`${schema.products.sourceUrl} is not null`),
  });
  const changes: { product: string; option: string; old_cost_minor: number | null; new_cost_minor: number; stock: number | null }[] = [];
  for (const p of products) {
    let remote;
    try {
      remote = await suppliers.forUrl(p.sourceUrl!).getProductFromUrl(p.sourceUrl!);
    } catch {
      continue;
    }
    const variants = await db.query.variants.findMany({ where: eq(schema.variants.productId, p.id) });
    for (const v of variants) {
      const r = remote.variants.find((x) => x.ref === v.supplierVariantRef);
      if (!r) continue;
      if (r.costMinor !== v.costMinor || r.stock !== v.stock) {
        await db.update(schema.variants).set({ costMinor: r.costMinor, stock: r.stock }).where(eq(schema.variants.id, v.id));
        if (r.costMinor !== v.costMinor) changes.push({ product: p.title, option: v.title, old_cost_minor: v.costMinor, new_cost_minor: r.costMinor, stock: r.stock });
      }
    }
  }
  return changes;
}

/** Products losing money or close to it: what the margin agent is asked to look at. */
export async function thinMargins(run: Pick<RunScope, "ctx" | "shop">, minPct = 10) {
  const all = await productMargins({ ...run, runId: "", agent: "margin", conversationId: null, orderId: null, productId: null });
  return all.filter((r) => r.on_sale && r.margin_pct !== null && r.margin_pct < minPct);
}

export async function setAiSettings(
  db: RunScope["ctx"]["db"],
  shop: Pick<RunScope["shop"], "id" | "plan">,
  s: { budgetMinor?: number | null; autoReplyTopics?: string[]; autoPause?: boolean },
) {
  const max = PLAN_AI_BUDGET_MINOR[shop.plan];
  if (s.budgetMinor !== undefined && s.budgetMinor !== null && (!Number.isFinite(s.budgetMinor) || s.budgetMinor < 0 || s.budgetMinor > max)) {
    throw new UserError(`Pick a budget between $0 and ${formatMoney(max, "USD")} a month on your plan.`);
  }
  const topics = s.autoReplyTopics?.filter((t): t is BuyerTopic => t in BUYER_TOPICS);
  await db
    .update(schema.shops)
    .set({
      ...(s.budgetMinor !== undefined ? { aiBudgetMinor: s.budgetMinor === max ? null : s.budgetMinor } : {}),
      ...(topics ? { aiAutoReplyTopics: topics } : {}),
      ...(s.autoPause !== undefined ? { aiAutoPause: s.autoPause } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.shops.id, shop.id));
}

/** What AI each plan includes per month, in US cents of model usage. */
export const PLAN_AI_BUDGET_MINOR: Record<keyof typeof PLANS, number> = { free: 100, starter: 500, growth: 2000, scale: 5000 };

export const AGENT_TOOLS: Record<AgentName, AgentTool[]> = {
  listing: listingTools,
  assistant: assistantTools,
  buyer_support: buyerTools,
  fulfilment: fulfilmentTools,
  margin: marginTools,
  writer: writerTools,
};

export function findTool(agent: AgentName, name: string) {
  return AGENT_TOOLS[agent].find((t) => t.name === name) ?? null;
}

/** The tool list sent to the model: name, description and JSON schema. */
export function toolSpecs(agent: AgentName) {
  return AGENT_TOOLS[agent].map((t) => {
    const { $schema: _, ...input_schema } = z.toJSONSchema(t.input) as Record<string, unknown>;
    return { name: t.name, description: t.description, input_schema: input_schema as { type: "object" } };
  });
}


