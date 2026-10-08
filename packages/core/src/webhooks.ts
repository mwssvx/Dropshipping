// Outgoing webhooks: tell a store's other systems when orders are paid, shipped, delivered or
// refunded and when products change. Like push notifications, events are found by looking at what
// changed, queued once per endpoint, signed, and retried with growing gaps.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { schema, WEBHOOK_EVENTS, type Db, type WebhookEvent } from "@sf/db";
import { publicOrder, publicProduct } from "./api-keys";
import { NotFoundError, UserError } from "./errors";

const MINUTE = 60_000;
/** Gaps between tries: 1 min, 5 min, 30 min, 2 h, 12 h. Six tries in all, over about 15 hours. */
export const WEBHOOK_BACKOFF = [1, 5, 30, 120, 720].map((m) => m * MINUTE);
export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "order.paid": "Order paid",
  "order.shipped": "Order shipped",
  "order.delivered": "Order delivered",
  "order.refunded": "Order refunded",
  "product.updated": "Product created or changed",
};

export type WebhookContext = {
  db: Db;
  fetch?: typeof fetch;
  /** Development and tests only: allow http:// and addresses on private networks. */
  allowPrivate?: boolean;
};

export async function createWebhookEndpoint(db: Db, shopId: string, input: { url: string; events: string[] }, opts: { allowPrivate?: boolean } = {}) {
  const url = checkUrl(input.url, opts.allowPrivate);
  const events = WEBHOOK_EVENTS.filter((e) => input.events.includes(e));
  if (!events.length) throw new UserError("Pick at least one event to send.");
  const existing = await db.query.webhookEndpoints.findMany({ where: eq(schema.webhookEndpoints.shopId, shopId) });
  if (existing.length >= 10) throw new UserError("A store can have up to 10 webhook addresses.");
  if (existing.some((e) => e.url === url)) throw new UserError("That address is already on the list.");
  const [row] = await db.insert(schema.webhookEndpoints).values({ shopId, url, events, secret: `whsec_${randomBytes(24).toString("base64url")}` }).returning();
  return row!;
}

function checkUrl(raw: string, allowPrivate = false) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UserError("Enter a full address starting with https://");
  }
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) throw new UserError("Webhook addresses must start with https://");
  if (url.username || url.password) throw new UserError("Leave the user name and password out of the address.");
  if (!allowPrivate && isPrivateHost(url.hostname)) throw new UserError("That address is on a private network. Use one that's reachable from the internet.");
  return url.toString();
}

/** Loopback, private, link-local and similar addresses that must never be reached from our servers. */
export function isPrivateHost(host: string) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (isIP(h) === 4) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(h) === 6) return h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:");
  return false;
}

export async function listWebhookEndpoints(db: Db, shopId: string) {
  const endpoints = await db.query.webhookEndpoints.findMany({ where: eq(schema.webhookEndpoints.shopId, shopId), orderBy: asc(schema.webhookEndpoints.createdAt) });
  const deliveries = endpoints.length
    ? await db.query.webhookDeliveries.findMany({
        where: inArray(schema.webhookDeliveries.endpointId, endpoints.map((e) => e.id)),
        orderBy: desc(schema.webhookDeliveries.createdAt),
        limit: 50,
      })
    : [];
  return endpoints.map((e) => ({ ...e, deliveries: deliveries.filter((d) => d.endpointId === e.id).slice(0, 10) }));
}

export async function deleteWebhookEndpoint(db: Db, shopId: string, id: string) {
  const [row] = await db.delete(schema.webhookEndpoints).where(and(eq(schema.webhookEndpoints.id, id), eq(schema.webhookEndpoints.shopId, shopId))).returning();
  if (!row) throw new NotFoundError("Webhook");
}

export async function setWebhookEndpointActive(db: Db, shopId: string, id: string, active: boolean) {
  const [row] = await db.update(schema.webhookEndpoints).set({ active }).where(and(eq(schema.webhookEndpoints.id, id), eq(schema.webhookEndpoints.shopId, shopId))).returning();
  if (!row) throw new NotFoundError("Webhook");
  return row;
}

/* Signing */

/** The X-Storefront-Signature header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`. */
export function signWebhook(secret: string, body: string, now = new Date()) {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** For receivers (and our docs): checks the signature and that it's no older than five minutes. */
export function verifyWebhookSignature(secret: string, header: string, body: string, now = new Date(), toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(now.getTime() / 1000 - t) > toleranceSec) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/* Events */

type Found = { event: WebhookEvent; ref: string; at: Date; data: Record<string, unknown> };

export async function collectWebhookEvents(db: Db, shopId: string, since: Date, wanted: Set<WebhookEvent>): Promise<Found[]> {
  const found: Found[] = [];
  const orderIds = new Set<string>();
  const paid = wanted.has("order.paid")
    ? await db.query.orders.findMany({ where: and(eq(schema.orders.shopId, shopId), isNotNull(schema.orders.paidAt), gte(schema.orders.paidAt, since)), limit: 500 })
    : [];
  const shipped =
    wanted.has("order.shipped") || wanted.has("order.delivered")
      ? await db.query.fulfillments.findMany({
          where: and(eq(schema.fulfillments.shopId, shopId), isNotNull(schema.fulfillments.trackingNumber), gte(schema.fulfillments.updatedAt, since)),
          limit: 500,
        })
      : [];
  const refunds = wanted.has("order.refunded")
    ? await db.query.refunds.findMany({ where: and(eq(schema.refunds.shopId, shopId), gte(schema.refunds.createdAt, since)), limit: 500 })
    : [];
  for (const o of paid) orderIds.add(o.id);
  for (const f of shipped) orderIds.add(f.orderId);
  for (const r of refunds) orderIds.add(r.orderId);
  const orders = new Map<string, ReturnType<typeof publicOrder>>();
  if (orderIds.size) {
    const ids = [...orderIds];
    const [rows, lines, fulfillments] = await Promise.all([
      db.query.orders.findMany({ where: inArray(schema.orders.id, ids) }),
      db.query.orderLines.findMany({ where: inArray(schema.orderLines.orderId, ids) }),
      db.query.fulfillments.findMany({ where: inArray(schema.fulfillments.orderId, ids) }),
    ]);
    for (const o of rows) orders.set(o.id, publicOrder({ ...o, lines: lines.filter((l) => l.orderId === o.id), fulfillments: fulfillments.filter((f) => f.orderId === o.id) }));
  }
  for (const o of paid) found.push({ event: "order.paid", ref: o.id, at: o.paidAt!, data: { order: orders.get(o.id) } });
  for (const f of shipped) {
    if (wanted.has("order.shipped") && f.shippedAt && f.shippedAt >= since) found.push({ event: "order.shipped", ref: f.id, at: f.shippedAt, data: { order: orders.get(f.orderId) } });
    if (wanted.has("order.delivered") && f.deliveredAt && f.deliveredAt >= since) found.push({ event: "order.delivered", ref: f.id, at: f.deliveredAt, data: { order: orders.get(f.orderId) } });
  }
  for (const r of refunds) {
    found.push({ event: "order.refunded", ref: r.id, at: r.createdAt, data: { refund: { id: r.id, amount: r.amountMinor, reason: r.reason, created_at: r.createdAt.toISOString() }, order: orders.get(r.orderId) } });
  }
  if (wanted.has("product.updated")) {
    const products = await db.query.products.findMany({ where: and(eq(schema.products.shopId, shopId), gte(schema.products.updatedAt, since)), limit: 500 });
    const variants = products.length ? await db.query.variants.findMany({ where: inArray(schema.variants.productId, products.map((p) => p.id)), orderBy: asc(schema.variants.position) }) : [];
    for (const p of products) {
      found.push({ event: "product.updated", ref: `${p.id}:${p.updatedAt.getTime()}`, at: p.updatedAt, data: { product: publicProduct({ ...p, variants: variants.filter((v) => v.productId === p.id) }) } });
    }
  }
  return found;
}

/** Queues each new event for every active endpoint that wants it and was added before it happened. */
export async function queueShopWebhooks(db: Db, shopId: string, now = new Date(), windowMs = 48 * 3_600_000) {
  const endpoints = await db.query.webhookEndpoints.findMany({ where: and(eq(schema.webhookEndpoints.shopId, shopId), eq(schema.webhookEndpoints.active, true)) });
  if (!endpoints.length) return 0;
  const since = new Date(Math.max(now.getTime() - windowMs, Math.min(...endpoints.map((e) => e.createdAt.getTime()))));
  const events = await collectWebhookEvents(db, shopId, since, new Set(endpoints.flatMap((e) => e.events)));
  let queued = 0;
  for (const e of events) {
    for (const ep of endpoints) {
      if (!ep.events.includes(e.event) || e.at < ep.createdAt) continue;
      const payload = { event: e.event, created_at: e.at.toISOString(), data: e.data };
      const [row] = await db
        .insert(schema.webhookDeliveries)
        .values({ shopId, endpointId: ep.id, event: e.event, ref: e.ref, payload, nextAttemptAt: now })
        .onConflictDoNothing()
        .returning({ id: schema.webhookDeliveries.id });
      if (row) queued++;
    }
  }
  return queued;
}

async function post(ctx: WebhookContext, url: string, secret: string, body: string, headers: Record<string, string>, now: Date) {
  const doFetch = ctx.fetch ?? fetch;
  try {
    const u = new URL(url);
    if (!ctx.allowPrivate) {
      // Check what the name points at now, not only when it was added.
      const addresses = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true });
      if (addresses.some((a) => isPrivateHost(a.address))) return { ok: false, status: null, error: "The address points to a private network." };
    }
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Storefront-Webhooks/1", "x-storefront-signature": signWebhook(secret, body, now), ...headers },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel().catch(() => {});
    return res.ok ? { ok: true, status: res.status, error: null } : { ok: false, status: res.status, error: `The server answered ${res.status}.` };
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "No answer within 10 seconds." : `Couldn't connect: ${(e as Error).message}`.slice(0, 300);
    return { ok: false, status: null, error: msg };
  }
}

/** Sends what's due. A 2xx answer means delivered; anything else is retried until the sixth try. */
export async function deliverDueWebhooks(ctx: WebhookContext, now = new Date(), limit = 100) {
  const due = await ctx.db
    .select({ d: schema.webhookDeliveries, ep: schema.webhookEndpoints })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhookEndpoints, eq(schema.webhookEndpoints.id, schema.webhookDeliveries.endpointId))
    .where(and(eq(schema.webhookDeliveries.status, "pending"), lte(schema.webhookDeliveries.nextAttemptAt, now), eq(schema.webhookEndpoints.active, true)))
    .orderBy(asc(schema.webhookDeliveries.nextAttemptAt))
    .limit(limit);
  let delivered = 0;
  let failed = 0;
  for (const { d, ep } of due) {
    const body = JSON.stringify({ id: d.id, ...d.payload });
    const r = await post(ctx, ep.url, ep.secret, body, { "x-storefront-event": d.event, "x-storefront-delivery": d.id }, now);
    const attempts = d.attempts + 1;
    if (r.ok) {
      delivered++;
      await ctx.db.update(schema.webhookDeliveries).set({ status: "delivered", attempts, lastStatusCode: r.status, lastError: null, deliveredAt: now }).where(eq(schema.webhookDeliveries.id, d.id));
    } else {
      const gap = WEBHOOK_BACKOFF[attempts - 1];
      if (gap === undefined) failed++;
      await ctx.db
        .update(schema.webhookDeliveries)
        .set({ status: gap === undefined ? "failed" : "pending", attempts, lastStatusCode: r.status, lastError: r.error, nextAttemptAt: new Date(now.getTime() + (gap ?? 0)) })
        .where(eq(schema.webhookDeliveries.id, d.id));
    }
  }
  return { delivered, failed, tried: due.length };
}

/** Sends one delivery again now, whatever its state. */
export async function retryWebhookDelivery(db: Db, shopId: string, id: string, now = new Date()) {
  const [row] = await db
    .update(schema.webhookDeliveries)
    .set({ status: "pending", nextAttemptAt: now })
    .where(and(eq(schema.webhookDeliveries.id, id), eq(schema.webhookDeliveries.shopId, shopId)))
    .returning();
  if (!row) throw new NotFoundError("Delivery");
}

/** A signed "ping" so the merchant can check their receiver. Not stored or retried. */
export async function sendTestWebhook(ctx: WebhookContext, shopId: string, endpointId: string, now = new Date()) {
  const ep = await ctx.db.query.webhookEndpoints.findFirst({ where: and(eq(schema.webhookEndpoints.id, endpointId), eq(schema.webhookEndpoints.shopId, shopId)) });
  if (!ep) throw new NotFoundError("Webhook");
  const body = JSON.stringify({ id: `test_${randomBytes(6).toString("hex")}`, event: "ping", created_at: now.toISOString(), data: {} });
  return post(ctx, ep.url, ep.secret, body, { "x-storefront-event": "ping" }, now);
}

/** The scheduled job: queue new events for every store with an endpoint, then send what's due. */
export async function runWebhooks(ctx: WebhookContext, now = new Date()) {
  const shops = await ctx.db.selectDistinct({ shopId: schema.webhookEndpoints.shopId }).from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.active, true));
  let queued = 0;
  for (const { shopId } of shops) queued += await queueShopWebhooks(ctx.db, shopId, now);
  return { queued, ...(await deliverDueWebhooks(ctx, now)) };
}

/** After something happens in one store: queue and send its webhooks straight away. */
export async function sendShopWebhooks(ctx: WebhookContext, shopId: string, now = new Date()) {
  const queued = await queueShopWebhooks(ctx.db, shopId, now);
  if (!queued) return { queued, delivered: 0 };
  const { delivered } = await deliverDueWebhooks(ctx, now);
  return { queued, delivered };
}

