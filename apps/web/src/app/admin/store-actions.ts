"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addDomain,
  checkDomain,
  createCollection,
  createPage,
  deleteCollection,
  deletePage,
  discardThemeDraft,
  publishTheme,
  removeDomain,
  saveThemeDraft,
  setPrimaryDomain,
  updateCollection,
  updatePage,
  UserError,
  type ThemeDoc,
} from "@sf/core";
import { domains, requireShop } from "@/lib/server";
import type { FormState } from "./actions";

/** Every storefront page of this store, on every address, shows the change. */
function refreshStore(handle: string) {
  revalidatePath(`/s/${handle}`, "layout");
}

async function userErrors<T>(fn: () => Promise<T>): Promise<{ error: string } | { ok: T }> {
  try {
    return { ok: await fn() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

// Theme ---------------------------------------------------------------------------------------

export async function saveThemeAction(doc: unknown) {
  const { shop, db } = await requireShop();
  const r = await userErrors(() => saveThemeDraft(db, shop, doc));
  return "error" in r ? r : { savedAt: r.ok.updatedAt.toISOString(), hasChanges: r.ok.hasChanges };
}

export async function publishThemeAction(doc: unknown) {
  const { shop, db } = await requireShop();
  const r = await userErrors(async () => {
    await saveThemeDraft(db, shop, doc);
    return publishTheme(db, shop);
  });
  if ("error" in r) return r;
  refreshStore(shop.handle);
  return { publishedAt: r.ok.publishedAt.toISOString() };
}

export async function discardThemeAction(): Promise<{ doc: ThemeDoc }> {
  const { shop, db } = await requireShop();
  return { doc: await discardThemeDraft(db, shop) };
}

// Collections ---------------------------------------------------------------------------------

function readCollection(form: FormData) {
  return {
    title: String(form.get("title") ?? ""),
    description: String(form.get("description") ?? ""),
    imageUrl: String(form.get("imageUrl") ?? ""),
    productIds: form.getAll("productIds").map(String),
  };
}

export async function createCollectionAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop();
  const r = await userErrors(() => createCollection(db, shop.id, readCollection(form)));
  if ("error" in r) return r;
  refreshStore(shop.handle);
  redirect(`/admin/collections/${r.ok.id}?saved=1`);
}

export async function updateCollectionAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop();
  const r = await userErrors(() => updateCollection(db, shop.id, id, readCollection(form)));
  if ("error" in r) return r;
  refreshStore(shop.handle);
  revalidatePath("/admin/collections");
  return { saved: true };
}

export async function deleteCollectionAction(id: string) {
  const { shop, db } = await requireShop();
  await deleteCollection(db, shop.id, id);
  refreshStore(shop.handle);
  redirect("/admin/collections");
}

// Pages ---------------------------------------------------------------------------------------

function readPage(form: FormData) {
  return {
    title: String(form.get("title") ?? ""),
    handle: String(form.get("handle") ?? ""),
    body: String(form.get("body") ?? ""),
    seoDescription: String(form.get("seoDescription") ?? ""),
    published: form.get("published") === "on",
  };
}

export async function createPageAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop();
  const r = await userErrors(() => createPage(db, shop.id, readPage(form)));
  if ("error" in r) return r;
  refreshStore(shop.handle);
  redirect(`/admin/pages/${r.ok.id}?saved=1`);
}

export async function updatePageAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop();
  const r = await userErrors(() => updatePage(db, shop.id, id, readPage(form)));
  if ("error" in r) return r;
  refreshStore(shop.handle);
  revalidatePath("/admin/pages");
  return { saved: true };
}

export async function deletePageAction(id: string) {
  const { shop, db } = await requireShop();
  await deletePage(db, shop.id, id);
  refreshStore(shop.handle);
  redirect("/admin/pages");
}

// Domains -------------------------------------------------------------------------------------

export async function addDomainAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop } = await requireShop();
  const ctx = await domains();
  const r = await userErrors(async () => {
    const d = await addDomain(ctx, shop.id, String(form.get("hostname") ?? ""));
    // Records the merchant set up ahead of time are picked up straight away.
    return checkDomain(ctx, shop.id, d.id);
  });
  if ("error" in r) return r;
  revalidatePath("/admin/domains");
  return { saved: true };
}

export async function checkDomainAction(id: string, _: FormState, _form: FormData): Promise<FormState> {
  const { shop } = await requireShop();
  const r = await userErrors(async () => checkDomain(await domains(), shop.id, id));
  if ("error" in r) return r;
  revalidatePath("/admin/domains");
  return r.ok.verifiedAt && !r.ok.lastError ? { saved: true } : { error: r.ok.lastError ?? "Not connected yet." };
}

export async function makePrimaryDomainAction(id: string) {
  const { shop, db } = await requireShop();
  await setPrimaryDomain(db, shop.id, id);
  revalidatePath("/admin/domains");
}

export async function removeDomainAction(id: string) {
  const { shop } = await requireShop();
  await removeDomain(await domains(), shop.id, id);
  revalidatePath("/admin/domains");
}
