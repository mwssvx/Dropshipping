"use server";
import { revalidatePath } from "next/cache";
import { createApiKey, createWebhookEndpoint, deleteWebhookEndpoint, deliverDueWebhooks, retryWebhookDelivery, revokeApiKey, sendTestWebhook, setWebhookEndpointActive, UserError } from "@sf/core";
import { logged, requireShop, webhooks } from "@/lib/server";
import type { FormState } from "./actions";

export type KeyState = FormState & { key?: string; name?: string };

export async function createApiKeyAction(_: KeyState, form: FormData): Promise<KeyState> {
  const { shop, db, user } = await requireShop("developers");
  try {
    const { key, row } = await createApiKey(db, shop.id, { name: String(form.get("name") ?? ""), access: form.get("access") === "write" ? "write" : "read" }, user.id);
    await logged({ shop, user, db }, `Created the ${row.access === "write" ? "read and write" : "read-only"} API key “${row.name}”`, { href: "/admin/developers" });
    revalidatePath("/admin/developers");
    return { saved: true, key, name: row.name };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function revokeApiKeyAction(id: string) {
  const { shop, db, user } = await requireShop("developers");
  const key = await db.query.apiKeys.findFirst({ where: (k, { and, eq }) => and(eq(k.id, id), eq(k.shopId, shop.id)), columns: { name: true } });
  await revokeApiKey(db, shop.id, id);
  if (key) await logged({ shop, user, db }, `Revoked the API key “${key.name}”`, { href: "/admin/developers" });
  revalidatePath("/admin/developers");
}

export async function addWebhookAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db, user } = await requireShop("developers");
  try {
    const url = String(form.get("url") ?? "");
    await createWebhookEndpoint(db, shop.id, { url, events: form.getAll("events").map(String) }, { allowPrivate: (await webhooks()).allowPrivate });
    await logged({ shop, user, db }, `Added a webhook to ${url.trim()}`, { href: "/admin/developers" });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/developers");
  return { saved: true };
}

export type TestState = { message?: string; ok?: boolean };

export async function testWebhookAction(id: string, _: TestState, _form: FormData): Promise<TestState> {
  const { shop } = await requireShop("developers");
  const r = await sendTestWebhook(await webhooks(), shop.id, id);
  return r.ok ? { ok: true, message: `Delivered. Your server answered ${r.status}.` } : { ok: false, message: r.error ?? "It didn't arrive." };
}

export async function setWebhookActiveAction(id: string, active: boolean) {
  const { shop, db } = await requireShop("developers");
  await setWebhookEndpointActive(db, shop.id, id, active);
  revalidatePath("/admin/developers");
}

export async function deleteWebhookAction(id: string) {
  const { shop, db, user } = await requireShop("developers");
  const hook = await db.query.webhookEndpoints.findFirst({ where: (w, { and, eq }) => and(eq(w.id, id), eq(w.shopId, shop.id)), columns: { url: true } });
  await deleteWebhookEndpoint(db, shop.id, id);
  if (hook) await logged({ shop, user, db }, `Removed the webhook to ${hook.url}`, { href: "/admin/developers" });
  revalidatePath("/admin/developers");
}

export async function retryDeliveryAction(id: string) {
  const { shop, db } = await requireShop("developers");
  await retryWebhookDelivery(db, shop.id, id);
  await deliverDueWebhooks(await webhooks());
  revalidatePath("/admin/developers");
}
