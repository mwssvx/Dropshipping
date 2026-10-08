"use server";
import { revalidatePath } from "next/cache";
import { createApiKey, createWebhookEndpoint, deleteWebhookEndpoint, deliverDueWebhooks, retryWebhookDelivery, revokeApiKey, sendTestWebhook, setWebhookEndpointActive, UserError } from "@sf/core";
import { requireShop, webhooks } from "@/lib/server";
import type { FormState } from "./actions";

export type KeyState = FormState & { key?: string; name?: string };

export async function createApiKeyAction(_: KeyState, form: FormData): Promise<KeyState> {
  const { shop, db, user } = await requireShop("developers");
  try {
    const { key, row } = await createApiKey(db, shop.id, { name: String(form.get("name") ?? ""), access: form.get("access") === "write" ? "write" : "read" }, user.id);
    revalidatePath("/admin/developers");
    return { saved: true, key, name: row.name };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function revokeApiKeyAction(id: string) {
  const { shop, db } = await requireShop("developers");
  await revokeApiKey(db, shop.id, id);
  revalidatePath("/admin/developers");
}

export async function addWebhookAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("developers");
  try {
    await createWebhookEndpoint(db, shop.id, { url: String(form.get("url") ?? ""), events: form.getAll("events").map(String) }, { allowPrivate: (await webhooks()).allowPrivate });
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
  const { shop, db } = await requireShop("developers");
  await deleteWebhookEndpoint(db, shop.id, id);
  revalidatePath("/admin/developers");
}

export async function retryDeliveryAction(id: string) {
  const { shop, db } = await requireShop("developers");
  await retryWebhookDelivery(db, shop.id, id);
  await deliverDueWebhooks(await webhooks());
  revalidatePath("/admin/developers");
}
