import "server-only";
import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { openDb, type Db } from "@sf/db";
import {
  dnsTargetsFromEnv,
  domainHostFromEnv,
  getSessionUser,
  listShopsForUser,
  mailerFromEnv,
  modelFromEnv,
  paymentProviderFromEnv,
  pushSenderFromEnv,
  sendShopNotifications,
  primaryDomain,
  requireMember,
  suppliersFromEnv,
  taxCalculatorFromEnv,
  type AgentContext,
  type DomainContext,
  type DomainHost,
  type FulfillmentContext,
  type Mailer,
  type ModelClient,
  type PaymentProvider,
  type PushSender,
  type RefundContext,
  type Suppliers,
  type TaxCalculator,
} from "@sf/core";
import { ROOT_DOMAIN, STORE_SUBDOMAINS } from "./brand";

// The database is shared across the whole server process. Everything else is kept per module
// copy: Next bundles route handlers and pages separately, each with its own copy of @sf/core, and
// an object made by one copy fails the other copy's instanceof checks (errors, providers).
const g = globalThis as unknown as { __sfDb?: Promise<Db> };
const local: {
  payments?: PaymentProvider;
  suppliers?: Suppliers;
  mailer?: Mailer;
  domainHost?: DomainHost;
  tax?: TaxCalculator;
  model?: ModelClient;
  push?: PushSender;
} = {};

export function db(): Promise<Db> {
  // A failed connection isn't cached, so the next request tries again.
  g.__sfDb ??= openDb({ url: process.env.DATABASE_URL || undefined, dataDir: process.env.DATA_DIR || undefined }).catch((e) => {
    g.__sfDb = undefined;
    throw e;
  });
  return g.__sfDb;
}

export function payments(): PaymentProvider {
  local.payments ??= paymentProviderFromEnv(process.env);
  return local.payments;
}

export function tax(): TaxCalculator {
  local.tax ??= taxCalculatorFromEnv(process.env);
  return local.tax;
}

export function suppliers(): Suppliers {
  local.suppliers ??= suppliersFromEnv(process.env);
  return local.suppliers;
}

export function mailer(): Mailer {
  local.mailer ??= mailerFromEnv(process.env);
  return local.mailer;
}

/** Platform address of a store, e.g. https://glow.example.com */
export function storeUrl(handle: string) {
  const scheme = ROOT_DOMAIN.startsWith("localhost") ? "http" : "https";
  return STORE_SUBDOMAINS ? `${scheme}://${handle}.${ROOT_DOMAIN}` : `${scheme}://${ROOT_DOMAIN}/s/${handle}`;
}

/** The address buyers should see: the store's main custom domain once one is connected. */
export async function storeAddress(shop: { id: string; handle: string }) {
  const domain = await primaryDomain(await db(), shop.id);
  return domain ? `https://${domain}` : storeUrl(shop.handle);
}

export async function domains(): Promise<DomainContext> {
  local.domainHost ??= domainHostFromEnv(process.env);
  return { db: await db(), host: local.domainHost, platformHosts: [ROOT_DOMAIN], targets: dnsTargetsFromEnv(process.env) };
}

/** An absolute link back into the admin, for pages the payment provider sends the merchant back from. */
export async function adminUrl(path: string) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? ROOT_DOMAIN;
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}${path}`;
}

/** Test mode: no real money moves, so the admin offers buttons to simulate payouts and holds. */
export const testPayments = () => payments().name === "fake";

export async function fulfillment(): Promise<FulfillmentContext> {
  return {
    db: await db(),
    suppliers: suppliers(),
    mailer: mailer(),
    orderStatusUrl: async (shop, order) => `${await storeAddress(shop)}/orders/${order.paymentIntentId}`,
  };
}

export const SESSION_COOKIE = "sf_session";
export const SHOP_COOKIE = "sf_shop";

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionUser(await db(), token);
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** The signed-in merchant's selected store. Sends them to create one if they have none. */
export async function requireShop() {
  const user = await requireUser();
  const database = await db();
  const shops = await listShopsForUser(database, user.id);
  if (!shops.length) redirect("/admin/new-store");
  const wanted = (await cookies()).get(SHOP_COOKIE)?.value;
  const pick = shops.find((s) => s.id === wanted) ?? shops[0]!;
  const { shop, role } = await requireMember(database, user.id, pick.id);
  return { user, shop, role, shops, db: database };
}

export async function refunds(): Promise<RefundContext> {
  return { ...(await fulfillment()), payments: payments() };
}

/** Platform staff, listed by email in STAFF_EMAILS. Everyone else gets a 404, so the pages stay hidden. */
export async function requireStaff() {
  const user = await requireUser();
  const staff = (process.env.STAFF_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!staff.includes(user.email.toLowerCase())) notFound();
  return { user, db: await db() };
}

/** Claude when ANTHROPIC_API_KEY is set, otherwise the built-in demo brain. */
export function aiModel(): ModelClient {
  local.model ??= modelFromEnv(process.env);
  return local.model;
}

export async function agents(): Promise<AgentContext> {
  return { ...(await refunds()), model: aiModel() };
}

export function pushSender(): PushSender {
  local.push ??= pushSenderFromEnv(process.env);
  return local.push;
}

/** Sends any new push notifications for a store after the response is out. Safe to call often. */
export function notifyLater(shopId: string) {
  after(async () => {
    try {
      await sendShopNotifications({ db: await db(), push: pushSender() }, shopId);
    } catch (e) {
      console.error(`Push notifications for store ${shopId} failed; the scheduled job will retry.`, e);
    }
  });
}
