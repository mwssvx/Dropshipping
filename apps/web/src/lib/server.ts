import "server-only";
import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { openDb, type Db } from "@sf/db";
import {
  logActivity,
  dnsTargetsFromEnv,
  domainHostFromEnv,
  fxFromEnv,
  type FxProvider,
  googleFromEnv,
  type GoogleProvider,
  getSessionUser,
  listShopsForUser,
  mailerFromEnv,
  modelFromEnv,
  paymentProviderFromEnv,
  pushSenderFromEnv,
  sendShopNotifications,
  sendShopWebhooks,
  primaryDomain,
  requireMember,
  can,
  type Area,
  suppliersFromEnv,
  taxCalculatorFromEnv,
  type AgentContext,
  type CampaignContext,
  type DomainContext,
  type DomainHost,
  type FulfillmentContext,
  type SubscriptionContext,
  type Mailer,
  type ModelClient,
  type PaymentProvider,
  type PushSender,
  type RefundContext,
  type Suppliers,
  type TaxCalculator,
  type WebhookContext,
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
  fx?: FxProvider;
  google?: GoogleProvider;
} = {};

/** Exchange rates for stores that sell in more than one currency. */
export function fxRates(): FxProvider {
  local.fx ??= fxFromEnv(process.env);
  return local.fx;
}

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

type OutboxItem = { to: string; subject: string; text: string; at: Date };
const outbox = ((globalThis as { __sfOutbox?: OutboxItem[] }).__sfOutbox ??= []);

/** Development and tests (EMAIL_PREVIEW=on with no real mailer): the last emails "sent", newest first. */
export function previewOutbox() {
  return process.env.EMAIL_PREVIEW === "on" && mailer().name === "log" ? [...outbox].reverse() : null;
}

export function mailer(): Mailer {
  if (!local.mailer) {
    const real = mailerFromEnv(process.env);
    local.mailer =
      process.env.EMAIL_PREVIEW === "on" && real.name === "log"
        ? { name: real.name, send: async (e) => (outbox.push({ ...e, at: new Date() }), outbox.splice(0, outbox.length - 50), real.send(e)) }
        : real;
  }
  return local.mailer;
}

/** Platform address of a store, e.g. https://glow.example.com */
export function storeUrl(handle: string) {
  const scheme = ROOT_DOMAIN.startsWith("localhost") ? "http" : "https";
  return STORE_SUBDOMAINS ? `${scheme}://${handle}.${ROOT_DOMAIN}` : `${scheme}://${ROOT_DOMAIN}/s/${handle}`;
}

/** The private page where one of a merchant's own suppliers adds tracking. On the platform's address, not a store's. */
export function supplierPortalUrl(token: string) {
  return `${ROOT_DOMAIN.startsWith("localhost") ? "http" : "https"}://${ROOT_DOMAIN}/supplier/${token}`;
}

/** A partner's private page with their code and what they've earned. On the platform's address, not a store's. */
export function partnerPortalUrl(token: string) {
  return `${ROOT_DOMAIN.startsWith("localhost") ? "http" : "https"}://${ROOT_DOMAIN}/partner/${token}`;
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

/** An absolute link into the admin from outside a request (emails sent by webhooks and the schedule). */
export function platformUrl(path: string) {
  return `${/^(localhost|127\.0\.0\.1)(:|$)/.test(ROOT_DOMAIN) ? "http" : "https"}://${ROOT_DOMAIN}${path}`;
}

/** Emailing a store's team about things that need them: new disputes, supplier price rises. */
export async function adminNotices() {
  return { db: await db(), mailer: mailer(), adminUrl: platformUrl };
}

/** Test mode: no real money moves, so the admin offers buttons to simulate payouts and holds. */
export const testPayments = () => payments().name === "fake";

/** Supplier stock sync and back-in-stock emails. */
export async function stock() {
  return { ...(await fulfillment()), storeAddress };
}

/** Subscribe and save: the scheduled deliveries, charged to the buyer's saved card. */
export async function subscriptions(): Promise<SubscriptionContext> {
  return { ...(await fulfillment()), payments: payments(), taxCalculator: tax(), manageUrl: async (shop, token) => `${await storeAddress(shop)}/subscriptions/${token}` };
}

export async function fulfillment(): Promise<FulfillmentContext> {
  return {
    db: await db(),
    suppliers: suppliers(),
    mailer: mailer(),
    orderStatusUrl: async (shop, order) => `${await storeAddress(shop)}/orders/${order.paymentIntentId}`,
    payUrl: async (shop, order) => `${await storeAddress(shop)}/pay/${order.id}`,
    supplierPortalUrl,
    storeAddress,
  };
}

export async function campaigns(): Promise<CampaignContext> {
  return { db: await db(), mailer: mailer(), storeAddress };
}

export const SESSION_COOKIE = "sf_session";
export const SHOP_COOKIE = "sf_shop";
/** A right password waiting for its two-step code (10 minutes). */
export const TWO_STEP_COOKIE = "sf_two_step";

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionUser(await db(), token);
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The signed-in merchant's selected store. Sends them to create one if they have none. With an
 * area, people whose role can't open it go back to Home with a note instead.
 */
export async function requireShop(area?: Area) {
  const user = await requireUser();
  const database = await db();
  const shops = await listShopsForUser(database, user.id);
  if (!shops.length) redirect("/admin/new-store");
  const wanted = (await cookies()).get(SHOP_COOKIE)?.value;
  const pick = shops.find((s) => s.id === wanted) ?? shops[0]!;
  const { shop, role } = await requireMember(database, user.id, pick.id);
  if (area && !can(role, area)) redirect(`/admin?denied=${area}`);
  return { user, shop, role, shops, db: database };
}

/**
 * Notes a team member's action in the store's activity log, after it worked. "{order}" in the
 * summary becomes the order's number when orderId is given. Never fails the action itself.
 */
export async function logged(
  who: { shop: { id: string }; user: { id: string; email: string }; db: Db },
  summary: string,
  opts?: { orderId?: string; href?: string },
) {
  try {
    await logActivity(who.db, { shopId: who.shop.id, userId: who.user.id, email: who.user.email }, summary, opts);
  } catch (e) {
    console.error("Couldn't write to the activity log", e);
  }
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
  return { ...(await refunds()), model: aiModel(), google: googleProvider(), connectorSecret: process.env.CONNECTOR_SECRET || undefined };
}

/** The owner's Google account for the Assistant: real with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, else a fake one. */
export function googleProvider(): GoogleProvider {
  local.google ??= googleFromEnv(process.env);
  return local.google;
}

/** Ties a Google sign-in to the browser and store that started it. */
export const GOOGLE_STATE_COOKIE = "sf_google_state";

export async function connectors() {
  return { db: await db(), google: googleProvider(), connectorSecret: process.env.CONNECTOR_SECRET || undefined };
}

export function pushSender(): PushSender {
  local.push ??= pushSenderFromEnv(process.env);
  return local.push;
}

/** Webhooks may only reach public https addresses, except in development and tests. */
export async function webhooks(): Promise<WebhookContext> {
  return { db: await db(), allowPrivate: process.env.WEBHOOKS_ALLOW_PRIVATE === "on" };
}

/**
 * Sends any new push notifications and webhooks for a store after the response is out. Safe to
 * call often: each event goes out once, and the scheduled job retries what fails.
 */
export function notifyLater(shopId: string) {
  after(async () => {
    try {
      await sendShopNotifications({ db: await db(), push: pushSender() }, shopId);
    } catch (e) {
      console.error(`Push notifications for store ${shopId} failed; the scheduled job will retry.`, e);
    }
    try {
      await sendShopWebhooks(await webhooks(), shopId);
    } catch (e) {
      console.error(`Webhooks for store ${shopId} failed; the scheduled job will retry.`, e);
    }
  });
}
