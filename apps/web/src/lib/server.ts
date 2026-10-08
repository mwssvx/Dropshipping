import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { openDb, type Db } from "@sf/db";
import {
  getSessionUser,
  listShopsForUser,
  mailerFromEnv,
  paymentProviderFromEnv,
  requireMember,
  suppliersFromEnv,
  type FulfillmentContext,
  type Mailer,
  type PaymentProvider,
  type Suppliers,
} from "@sf/core";
import { ROOT_DOMAIN, STORE_SUBDOMAINS } from "./brand";

const g = globalThis as unknown as { __sfDb?: Promise<Db>; __sfPayments?: PaymentProvider; __sfSuppliers?: Suppliers; __sfMailer?: Mailer };

export function db(): Promise<Db> {
  g.__sfDb ??= openDb({ url: process.env.DATABASE_URL || undefined, dataDir: process.env.DATA_DIR || undefined });
  return g.__sfDb;
}

export function payments(): PaymentProvider {
  g.__sfPayments ??= paymentProviderFromEnv(process.env);
  return g.__sfPayments;
}

export function suppliers(): Suppliers {
  g.__sfSuppliers ??= suppliersFromEnv(process.env);
  return g.__sfSuppliers;
}

export function mailer(): Mailer {
  g.__sfMailer ??= mailerFromEnv(process.env);
  return g.__sfMailer;
}

/** Public address of a store, e.g. https://glow.example.com */
export function storeUrl(handle: string) {
  const scheme = ROOT_DOMAIN.startsWith("localhost") ? "http" : "https";
  return STORE_SUBDOMAINS ? `${scheme}://${handle}.${ROOT_DOMAIN}` : `${scheme}://${ROOT_DOMAIN}/s/${handle}`;
}

export async function fulfillment(): Promise<FulfillmentContext> {
  return {
    db: await db(),
    suppliers: suppliers(),
    mailer: mailer(),
    orderStatusUrl: (shop, order) => `${storeUrl(shop.handle)}/orders/${order.paymentIntentId}`,
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
