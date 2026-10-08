import "server-only";
// The public REST API, at /api/v1/*, for a store's own tools and other apps. Authenticated with an
// API key from Settings > Developers ("Authorization: Bearer sfk_..."). Read keys can only GET.
// Amounts are integers in the store currency's minor unit (cents). Errors look like
// {"error": {"code": "...", "message": "..."}}.
import {
  addManualTracking,
  apiListOrders,
  apiListProducts,
  authenticateApiKey,
  getOrder,
  getProduct,
  NotFoundError,
  patchProduct,
  publicOrder,
  publicProduct,
  UserError,
  type Shop,
} from "@sf/core";
import type { Db } from "@sf/db";
import { db, fulfillment, notifyLater, storeAddress } from "./server";

type Ctx = { req: Request; url: URL; params: Record<string, string>; db: Db; shop: Shop; write: boolean };
type Handler = (c: Ctx) => Promise<unknown>;

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function json(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {}
  throw new ApiError(400, "invalid_json", "Send a JSON object as the body.");
}

function page(url: URL) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const p = Math.max(1, Math.floor(Number(url.searchParams.get("page") ?? 1) || 1));
  return { limit, offset: (p - 1) * limit, page: p };
}

function oneOf<T extends string>(v: string | null, allowed: readonly T[], name: string): T | undefined {
  if (v === null || v === "") return undefined;
  if (!(allowed as readonly string[]).includes(v)) throw new ApiError(400, "invalid_parameter", `${name} must be one of: ${allowed.join(", ")}.`);
  return v as T;
}

const PAYMENT = ["pending", "paid", "failed", "partially_refunded", "refunded"] as const;
const FULFILLMENT = ["unfulfilled", "sent_to_supplier", "partially_shipped", "shipped", "delivered", "problem"] as const;
const STATUS = ["draft", "active", "archived"] as const;

const routes: Record<string, Handler> = {
  "GET shop": async ({ shop }) => ({
    shop: { id: shop.id, name: shop.name, handle: shop.handle, currency: shop.currency, country: shop.country, url: await storeAddress(shop), plan: shop.plan },
  }),
  "GET orders": async ({ db, shop, url }) => {
    const p = page(url);
    const sinceRaw = url.searchParams.get("updated_since");
    const since = sinceRaw ? new Date(sinceRaw) : undefined;
    if (since && Number.isNaN(since.getTime())) throw new ApiError(400, "invalid_parameter", "updated_since must be an ISO 8601 date and time.");
    const { items, hasMore } = await apiListOrders(
      db,
      shop.id,
      { paymentStatus: oneOf(url.searchParams.get("payment_status"), PAYMENT, "payment_status"), fulfillmentStatus: oneOf(url.searchParams.get("fulfillment_status"), FULFILLMENT, "fulfillment_status"), since },
      p,
    );
    return { orders: items, page: p.page, has_more: hasMore };
  },
  "GET orders/:id": async ({ db, shop, params }) => ({ order: publicOrder(await getOrder(db, shop.id, params.id!)) }),
  "POST orders/:id/tracking": async ({ req, db, shop, params }) => {
    const b = await json(req);
    await addManualTracking(await fulfillment(), shop.id, params.id!, {
      carrier: String(b.carrier ?? ""),
      trackingNumber: String(b.tracking_number ?? ""),
      url: typeof b.tracking_url === "string" ? b.tracking_url : "",
    });
    notifyLater(shop.id);
    return { order: publicOrder(await getOrder(db, shop.id, params.id!)) };
  },
  "GET products": async ({ db, shop, url }) => {
    const p = page(url);
    const { items, hasMore } = await apiListProducts(db, shop.id, { status: oneOf(url.searchParams.get("status"), STATUS, "status") }, p);
    return { products: items, page: p.page, has_more: hasMore };
  },
  "GET products/:id": async ({ db, shop, params }) => ({ product: publicProduct(await getProduct(db, shop.id, params.id!)) }),
  "PATCH products/:id": async ({ req, db, shop, params }) => {
    const b = await json(req);
    const variants = Array.isArray(b.variants)
      ? (b.variants as Record<string, unknown>[]).map((v) => ({
          id: String(v.id ?? ""),
          ...(v.price !== undefined ? { priceMinor: v.price as number } : {}),
          ...(v.stock !== undefined ? { stock: v.stock as number | null } : {}),
        }))
      : undefined;
    await patchProduct(db, shop.id, params.id!, { status: oneOf(typeof b.status === "string" ? b.status : null, STATUS, "status"), variants });
    notifyLater(shop.id);
    return { product: publicProduct(await getProduct(db, shop.id, params.id!)) };
  },
};

function match(method: string, path: string) {
  const parts = path.split("/").filter(Boolean);
  let pathFound = false;
  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(" ") as [string, string];
    const pp = pattern.split("/");
    if (pp.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (!pp.every((p, i) => (p.startsWith(":") ? ((params[p.slice(1)] = decodeURIComponent(parts[i]!)), true) : p === parts[i]))) continue;
    pathFound = true;
    if (m === method) return { key, params };
  }
  if (pathFound) throw new ApiError(405, "method_not_allowed", `${method} isn't supported here.`);
  throw new ApiError(404, "not_found", "No such endpoint. See Settings > Developers for the list.");
}

// A simple per-key limit: 120 requests a minute on each server.
const windows = new Map<string, { start: number; count: number }>();
function rateLimit(keyId: string, now = Date.now()) {
  const w = windows.get(keyId);
  if (!w || now - w.start >= 60_000) {
    windows.set(keyId, { start: now, count: 1 });
    if (windows.size > 10_000) windows.clear();
    return null;
  }
  w.count++;
  return w.count > 120 ? Math.ceil((w.start + 60_000 - now) / 1000) : null;
}

export async function handlePublicApi(req: Request, path: string[]): Promise<Response> {
  const headers: Record<string, string> = { "cache-control": "no-store" };
  const route = path.join("/");
  try {
    const found = match(req.method, route);
    const auth = req.headers.get("authorization") ?? "";
    const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const database = await db();
    const who = key ? await authenticateApiKey(database, key) : null;
    if (!who) throw new ApiError(401, "unauthorized", "Send a valid API key as \"Authorization: Bearer sfk_...\".");
    const wait = rateLimit(who.key.id);
    if (wait) {
      headers["retry-after"] = String(wait);
      throw new ApiError(429, "rate_limited", "Too many requests. Slow down to 120 a minute.");
    }
    const write = req.method !== "GET";
    if (write && who.key.access !== "write") throw new ApiError(403, "read_only_key", "This key can only read. Create a read and write key to make changes.");
    const result = await routes[found.key]!({ req, url: new URL(req.url), params: found.params, db: database, shop: who.shop, write });
    return Response.json(result, { headers });
  } catch (e) {
    const err = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers });
    if (e instanceof ApiError) return err(e.status, e.code, e.message);
    if (e instanceof NotFoundError) return err(404, "not_found", e.message);
    if (e instanceof UserError) return err(400, e.code ?? "invalid_request", e.message);
    console.error(`Public API ${req.method} /${route} failed`, e);
    return err(500, "server_error", "Something went wrong on our side. Please try again.");
  }
}
