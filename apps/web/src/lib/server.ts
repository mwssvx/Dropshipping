import "server-only";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { openDb, type Db } from "@sf/db";
import {
  dnsTargetsFromEnv,
  domainHostFromEnv,
  getSessionUser,
  listShopsForUser,
  mailerFromEnv,
  paymentProviderFromEnv,
  primaryDomain,
  requireMember,
  suppliersFromEnv,
  taxCalculatorFromEnv,
  type DomainContext,
  type DomainHost,
  type FulfillmentContext,
  type Mailer,
  type PaymentProvider,
  type RefundContext,
  type Suppliers,
  type TaxCalculator,
} from "@sf/core";
import { ROOT_DOMAIN, STORE_SUBDOMAINS } from "./brand";

const g = globalThis as unknown as {
  __sfDb?: Promise<Db>;
  __sfPayments?: PaymentProvider;
  __sfSuppliers?: Suppliers;
  __sfMailer?: Mailer;
  __sfDomainHost?: DomainHost;
  __sfTax?: TaxCalculator;
};

export function db(): Promise<Db> {
  // A failed connection isn't cached, so the next request tries again.
  g.__sfDb ??= openDb({ url: process.env.DATABASE_URL || undefined, dataDir: process.env.DATA_DIR || undefined }).catch((e) => {
    g.__sfDb = undefined;
    throw e;
  });
  return g.__sfDb;
}

export function payments(): PaymentProvider {
  g.__sfPayments ??= paymentProviderFromEnv(process.env);
  return g.__sfPayments;
}

export function tax(): TaxCalculator {
  g.__sfTax ??= taxCalculatorFromEnv(process.env);
  return g.__sfTax;
}

export function suppliers(): Suppliers {
  g.__sfSuppliers ??= suppliersFromEnv(process.env);
  return g.__sfSuppliers;
}

export function mailer(): Mailer {
  g.__sfMailer ??= mailerFromEnv(process.env);
  return g.__sfMailer;
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
  g.__sfDomainHost ??= domainHostFromEnv(process.env);
  return { db: await db(), host: g.__sfDomainHost, platformHosts: [ROOT_DOMAIN], targets: dnsTargetsFromEnv(process.env) };
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
