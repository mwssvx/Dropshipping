"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addDomain,
  checkDomain,
  createCollection,
  createGiftGuides,
  rulesFromForm,
  createPage,
  deleteCollection,
  deletePage,
  discardThemeDraft,
  publishTheme,
  scheduleTheme,
  cancelThemeSchedule,
  keepScheduledTheme,
  removeDomain,
  saveThemeDraft,
  setPrimaryDomain,
  updateCollection,
  updatePage,
  UserError,
  type ThemeDoc,
  type CollectionInput,
} from "@sf/core";
import { domains, logged, requireShop } from "@/lib/server";
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
  const { shop, db } = await requireShop("theme");
  const r = await userErrors(() => saveThemeDraft(db, shop, doc));
  return "error" in r ? r : { savedAt: r.ok.updatedAt.toISOString(), hasChanges: r.ok.hasChanges };
}

export async function publishThemeAction(doc: unknown) {
  const { shop, db, user } = await requireShop("theme");
  const r = await userErrors(async () => {
    await saveThemeDraft(db, shop, doc);
    return publishTheme(db, shop);
  });
  if ("error" in r) return r;
  await logged({ shop, user, db }, "Published changes to the store's look", { href: "/admin/theme" });
  refreshStore(shop.handle);
  return { publishedAt: r.ok.publishedAt.toISOString() };
}

/** Saves the draft, then schedules a copy of it to go live by itself (and, with until, to switch back). */
export async function scheduleThemeAction(doc: unknown, at: string, until: string | null) {
  const { shop, db, user } = await requireShop("theme");
  const r = await userErrors(async () => {
    await saveThemeDraft(db, shop, doc);
    return scheduleTheme(db, shop, { at: new Date(at), until: until ? new Date(until) : null });
  });
  if ("error" in r) return r;
  await logged({ shop, user, db }, "Scheduled a new look for the store", { href: "/admin/theme" });
  return { schedule: r.ok };
}

export async function cancelThemeScheduleAction() {
  const { shop, db, user } = await requireShop("theme");
  await cancelThemeSchedule(db, shop.id);
  await logged({ shop, user, db }, "Cancelled the store's scheduled look", { href: "/admin/theme" });
}

export async function keepScheduledThemeAction() {
  const { shop, db, user } = await requireShop("theme");
  await keepScheduledTheme(db, shop.id);
  await logged({ shop, user, db }, "Kept the store's scheduled look instead of switching back", { href: "/admin/theme" });
}

export async function discardThemeAction(): Promise<{ doc: ThemeDoc }> {
  const { shop, db } = await requireShop("theme");
  return { doc: await discardThemeDraft(db, shop) };
}

// Collections ---------------------------------------------------------------------------------

function readCollection(form: FormData) {
  const auto = form.get("mode") === "auto";
  return {
    title: String(form.get("title") ?? ""),
    description: String(form.get("description") ?? ""),
    imageUrl: String(form.get("imageUrl") ?? ""),
    productIds: auto ? [] : form.getAll("productIds").map(String),
    rules: auto ? rulesFromForm(String(form.get("rules") ?? "")) : null,
    sortOrder: (form.get("sortOrder") ?? undefined) as CollectionInput["sortOrder"],
  };
}

export async function createCollectionAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("collections");
  const r = await userErrors(async () => createCollection(db, shop.id, readCollection(form)));
  if ("error" in r) return r;
  refreshStore(shop.handle);
  redirect(`/admin/collections/${r.ok.id}?saved=1`);
}

/** Makes the "Gifts under $25 / $50 / $100" collections the store doesn't have yet. */
export async function createGiftGuidesAction() {
  const { shop, db, user } = await requireShop("collections");
  const made = await createGiftGuides(db, shop);
  if (made.length) await logged({ shop, user, db }, `Made gift guides: ${made.map((c) => c.title).join(", ")}`, { href: "/admin/collections" });
  refreshStore(shop.handle);
  revalidatePath("/admin/collections");
  redirect(`/admin/collections?guides=${made.length}`);
}

export async function updateCollectionAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("collections");
  const r = await userErrors(async () => updateCollection(db, shop.id, id, readCollection(form)));
  if ("error" in r) return r;
  refreshStore(shop.handle);
  revalidatePath("/admin/collections");
  return { saved: true };
}

export async function deleteCollectionAction(id: string) {
  const { shop, db } = await requireShop("collections");
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
  const { shop, db } = await requireShop("pages");
  const r = await userErrors(() => createPage(db, shop.id, readPage(form)));
  if ("error" in r) return r;
  refreshStore(shop.handle);
  redirect(`/admin/pages/${r.ok.id}?saved=1`);
}

export async function updatePageAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("pages");
  const r = await userErrors(() => updatePage(db, shop.id, id, readPage(form)));
  if ("error" in r) return r;
  refreshStore(shop.handle);
  revalidatePath("/admin/pages");
  return { saved: true };
}

export async function deletePageAction(id: string) {
  const { shop, db } = await requireShop("pages");
  await deletePage(db, shop.id, id);
  refreshStore(shop.handle);
  redirect("/admin/pages");
}

// Domains -------------------------------------------------------------------------------------

export async function addDomainAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, user, db } = await requireShop("domains");
  const ctx = await domains();
  const r = await userErrors(async () => {
    const d = await addDomain(ctx, shop.id, String(form.get("hostname") ?? ""));
    await logged({ shop, user, db }, `Added the domain ${d.hostname}`, { href: "/admin/domains" });
    // Records the merchant set up ahead of time are picked up straight away.
    return checkDomain(ctx, shop.id, d.id);
  });
  if ("error" in r) return r;
  revalidatePath("/admin/domains");
  return { saved: true };
}

export async function checkDomainAction(id: string, _: FormState, _form: FormData): Promise<FormState> {
  const { shop } = await requireShop("domains");
  const r = await userErrors(async () => checkDomain(await domains(), shop.id, id));
  if ("error" in r) return r;
  revalidatePath("/admin/domains");
  return r.ok.verifiedAt && !r.ok.lastError ? { saved: true } : { error: r.ok.lastError ?? "Not connected yet." };
}

const domainName = async (db: Awaited<ReturnType<typeof requireShop>>["db"], shopId: string, id: string) =>
  (await db.query.domains.findFirst({ where: (d, { and, eq }) => and(eq(d.id, id), eq(d.shopId, shopId)), columns: { hostname: true } }))?.hostname;

export async function makePrimaryDomainAction(id: string) {
  const { shop, db, user } = await requireShop("domains");
  await setPrimaryDomain(db, shop.id, id);
  await logged({ shop, user, db }, `Made ${(await domainName(db, shop.id, id)) ?? "a domain"} the store's main address`, { href: "/admin/domains" });
  revalidatePath("/admin/domains");
}

export async function removeDomainAction(id: string) {
  const { shop, user, db } = await requireShop("domains");
  const hostname = await domainName(db, shop.id, id);
  await removeDomain(await domains(), shop.id, id);
  if (hostname) await logged({ shop, user, db }, `Removed the domain ${hostname}`, { href: "/admin/domains" });
  revalidatePath("/admin/domains");
}
