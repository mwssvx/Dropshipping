import { createHash } from "node:crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { schema, TRANSLATABLE, type Db, type TranslatableKind } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { getPublishedTheme } from "./themes";
import type { ThemeDoc } from "./theme-doc";
import { detailsText, parseDetails } from "./product-details";

/*
 * Store languages. A store is written in English; merchants can also show it in the languages of
 * the countries they sell to. Each language has its own address (/de/products/lamp), so search
 * engines list it and buyers can share it. The store's own words (products, collections, pages,
 * menus and home page text) are translated by the AI translator or by the merchant; the fixed
 * words of the store (buttons, checkout) come with the platform.
 */

export const LANGUAGES = {
  de: { name: "Deutsch", english: "German" },
  fr: { name: "Français", english: "French" },
  es: { name: "Español", english: "Spanish" },
  it: { name: "Italiano", english: "Italian" },
  nl: { name: "Nederlands", english: "Dutch" },
} as const;
export type Language = keyof typeof LANGUAGES;
export const LANGUAGE_CODES = Object.keys(LANGUAGES) as Language[];

export const isLanguage = (x: unknown): x is Language => typeof x === "string" && x in LANGUAGES;

/** The languages a store offers besides English, in a stable order. */
export function shopLanguages(shop: { languages?: string[] | null }): Language[] {
  return LANGUAGE_CODES.filter((l) => shop.languages?.includes(l));
}

export async function setShopLanguages(db: Db, shopId: string, languages: string[]) {
  const picked = LANGUAGE_CODES.filter((l) => languages.includes(l));
  if (languages.some((l) => !isLanguage(l))) throw new UserError("Pick from the languages listed.");
  await db.update(schema.shops).set({ languages: picked, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return picked;
}

/* ───────────── What gets translated ───────────── */

export type TranslationFields = Record<string, string>;

/** Section and menu settings that hold words buyers read (not links, ids, colours or names). */
const THEME_TEXT_KEYS = new Set(["text", "heading", "subheading", "buttonLabel", "label", "question", "answer", "quote", "title", "description", "placeholder"]);

function walkTheme(value: unknown, key: string | null, visit: (s: string) => string): unknown {
  if (typeof value === "string") return key && THEME_TEXT_KEYS.has(key) && value.trim() ? visit(value) : value;
  if (Array.isArray(value)) return value.map((v) => walkTheme(v, key, visit));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "colors" || k === "fonts" || k === "layout" ? v : walkTheme(v, k, visit)]));
  }
  return value;
}

/** Every piece of merchant-written text in a theme that buyers see, once each. */
export function themeStrings(doc: ThemeDoc): string[] {
  const found = new Set<string>();
  const visible = { ...doc, home: doc.home.filter((s) => !s.hidden) };
  walkTheme({ home: visible.home, menus: visible.menus, settings: { seo: visible.settings.seo } }, null, (s) => (found.add(s), s));
  return [...found];
}

/** The theme with its text swapped for the translations that exist; anything missing stays as written. */
export function translateTheme(doc: ThemeDoc, dictionary: TranslationFields | null | undefined): ThemeDoc {
  if (!dictionary || !Object.keys(dictionary).length) return doc;
  return walkTheme(doc, null, (s) => dictionary[s] || s) as ThemeDoc;
}

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

type Source = { kind: TranslatableKind; refId: string; label: string; fields: TranslationFields };

/** The original text of everything a store can translate. Archived products are left out. */
async function sources(db: Db, shop: { id: string; name: string }, only?: { kind: TranslatableKind; refId: string }): Promise<Source[]> {
  const out: Source[] = [];
  const want = (k: TranslatableKind) => !only || only.kind === k;
  if (want("theme")) {
    const strings = themeStrings(await getPublishedTheme(db, shop));
    if (strings.length) out.push({ kind: "theme", refId: shop.id, label: "Menus and home page", fields: Object.fromEntries(strings.map((s) => [s, s])) });
  }
  if (want("page")) {
    const rows = await db.query.pages.findMany({
      where: and(eq(schema.pages.shopId, shop.id), only ? eq(schema.pages.id, only.refId) : undefined),
      orderBy: asc(schema.pages.title),
    });
    for (const p of rows) out.push({ kind: "page", refId: p.id, label: p.title, fields: { title: p.title, body: p.body } });
  }
  if (want("collection")) {
    const rows = await db.query.collections.findMany({
      where: and(eq(schema.collections.shopId, shop.id), only ? eq(schema.collections.id, only.refId) : undefined),
      orderBy: asc(schema.collections.title),
    });
    for (const c of rows) out.push({ kind: "collection", refId: c.id, label: c.title, fields: { title: c.title, description: c.description } });
  }
  if (want("product")) {
    const rows = await db.query.products.findMany({
      where: and(eq(schema.products.shopId, shop.id), ne(schema.products.status, "archived"), only ? eq(schema.products.id, only.refId) : undefined),
      orderBy: asc(schema.products.title),
      columns: { id: true, title: true, descriptionHtml: true, details: true },
    });
    for (const p of rows) out.push({ kind: "product", refId: p.id, label: p.title, fields: { title: p.title, description: p.descriptionHtml, details: detailsText(p.details) } });
  }
  return out.map((s) => ({ ...s, fields: Object.fromEntries(Object.entries(s.fields).filter(([, v]) => v.trim())) }));
}

export type TranslationStatus = "missing" | "outdated" | "done";

function statusOf(source: Source, row: { fields: TranslationFields; sourceHash: string } | undefined): TranslationStatus {
  if (!row) return "missing";
  if (source.kind === "theme") {
    const left = Object.keys(source.fields).filter((s) => !row.fields[s]).length;
    return left === 0 ? "done" : left === Object.keys(source.fields).length ? "missing" : "outdated";
  }
  return row.sourceHash === hash(source.fields) ? "done" : "outdated";
}

/** Everything the store can translate into one language, with how far along each item is. */
export async function translationList(db: Db, shop: { id: string; name: string; languages?: string[] | null }, language: string) {
  if (!shopLanguages(shop).includes(language as Language)) throw new NotFoundError("Language");
  const [items, rows] = await Promise.all([
    sources(db, shop),
    db.query.translations.findMany({ where: and(eq(schema.translations.shopId, shop.id), eq(schema.translations.language, language)) }),
  ]);
  const byRef = new Map(rows.map((r) => [`${r.kind}:${r.refId}`, r]));
  return items.map((s) => {
    const row = byRef.get(`${s.kind}:${s.refId}`);
    return { kind: s.kind, refId: s.refId, label: s.label, status: statusOf(s, row), byAi: row?.byAi ?? false, updatedAt: row?.updatedAt ?? null };
  });
}

/** For the Languages page: per language, how many items are translated and how many need work. */
export async function translationSummary(db: Db, shop: { id: string; name: string; languages?: string[] | null }) {
  const out = [];
  for (const language of shopLanguages(shop)) {
    const list = await translationList(db, shop, language);
    out.push({
      language,
      total: list.length,
      done: list.filter((i) => i.status === "done").length,
      outdated: list.filter((i) => i.status === "outdated").length,
      missing: list.filter((i) => i.status === "missing").length,
    });
  }
  return out;
}

/** One item's original text and its translation, for the editor. */
export async function getTranslation(db: Db, shop: { id: string; name: string; languages?: string[] | null }, language: string, kind: string, refId: string) {
  if (!shopLanguages(shop).includes(language as Language)) throw new NotFoundError("Language");
  if (!(TRANSLATABLE as readonly string[]).includes(kind)) throw new NotFoundError("Item");
  const k = kind as TranslatableKind;
  const [source] = await sources(db, shop, { kind: k, refId });
  if (!source || (k === "theme" && refId !== shop.id)) throw new NotFoundError("Item");
  const row = await db.query.translations.findFirst({
    where: and(eq(schema.translations.shopId, shop.id), eq(schema.translations.language, language), eq(schema.translations.kind, k), eq(schema.translations.refId, refId)),
  });
  return { kind: k, refId, label: source.label, source: source.fields, fields: row?.fields ?? {}, status: statusOf(source, row), byAi: row?.byAi ?? false };
}

const LIMITS: Record<string, number> = { title: 200, description: 20_000, body: 50_000, details: 6_000 };

/**
 * Save a translation. Fields left empty fall back to the original; a translation with nothing in
 * it is removed. The original text's fingerprint is kept, so a later edit to the original marks
 * this translation out of date.
 */
export async function saveTranslation(
  db: Db,
  shop: { id: string; name: string; languages?: string[] | null },
  input: { language: string; kind: string; refId: string; fields: TranslationFields },
  opts: { byAi?: boolean } = {},
) {
  const current = await getTranslation(db, shop, input.language, input.kind, input.refId);
  const fields: TranslationFields = {};
  for (const [key, original] of Object.entries(current.source)) {
    const value = String(input.fields[key] ?? "").replace(/\r\n/g, "\n").trim();
    if (!value) continue;
    const max = current.kind === "theme" ? Math.max(200, original.length * 3) : LIMITS[key] ?? 5000;
    if (value.length > max) throw new UserError(`Keep the ${current.kind === "theme" ? "translation" : key} under ${max.toLocaleString("en-US")} characters.`);
    if (/<[a-z/][^>]*>/i.test(value)) throw new UserError("Translations are plain text, without HTML tags.");
    fields[key] = value;
  }
  const where = and(
    eq(schema.translations.shopId, shop.id),
    eq(schema.translations.language, input.language),
    eq(schema.translations.kind, current.kind),
    eq(schema.translations.refId, input.refId),
  );
  if (!Object.keys(fields).length) {
    await db.delete(schema.translations).where(where);
    return { saved: false, removed: true };
  }
  await db
    .insert(schema.translations)
    .values({ shopId: shop.id, language: input.language, kind: current.kind, refId: input.refId, fields, sourceHash: hash(current.source), byAi: !!opts.byAi })
    .onConflictDoUpdate({
      target: [schema.translations.shopId, schema.translations.language, schema.translations.kind, schema.translations.refId],
      set: { fields, sourceHash: hash(current.source), byAi: !!opts.byAi, updatedAt: new Date() },
    });
  return { saved: true, removed: false };
}

/** Items that still need translating into a language, theme and pages first, for the AI translator. */
export async function untranslated(db: Db, shop: { id: string; name: string; languages?: string[] | null }, language: string, limit: number) {
  const list = (await translationList(db, shop, language)).filter((i) => i.status !== "done");
  const picked = list.slice(0, limit);
  const out: { kind: TranslatableKind; refId: string; label: string; source: TranslationFields; current: TranslationFields }[] = [];
  for (const i of picked) {
    const t = await getTranslation(db, shop, language, i.kind, i.refId);
    // The theme only sends the text still missing, so its earlier translations stay as they are.
    const source = i.kind === "theme" ? Object.fromEntries(Object.entries(t.source).filter(([s]) => !t.fields[s])) : t.source;
    out.push({ kind: i.kind, refId: i.refId, label: i.label, source, current: t.fields });
  }
  return { items: out, left: list.length - picked.length };
}

/* ───────────── On the store ───────────── */

/** Translations of one kind for a set of items, by item id. Unknown languages give nothing. */
export async function translationsFor(db: Db, shopId: string, language: string | null, kind: TranslatableKind, refIds: string[]) {
  const map = new Map<string, TranslationFields>();
  if (!language || !refIds.length) return map;
  const rows = await db.query.translations.findMany({
    where: and(eq(schema.translations.shopId, shopId), eq(schema.translations.language, language), eq(schema.translations.kind, kind), inArray(schema.translations.refId, [...new Set(refIds)])),
    columns: { refId: true, fields: true },
  });
  for (const r of rows) map.set(r.refId, r.fields);
  return map;
}

/** Products (or anything with a product id and title) with their titles, descriptions and details in the buyer's language. */
export async function localizeProducts<T extends { id: string; title: string; descriptionHtml?: string; details?: { label: string; value: string }[] }>(db: Db, shopId: string, language: string | null, items: T[]): Promise<T[]> {
  if (!language || !items.length) return items;
  const map = await translationsFor(db, shopId, language, "product", items.map((i) => i.id));
  return items.map((i) => {
    const t = map.get(i.id);
    if (!t) return i;
    // A translated table that lost every line keeps the original.
    const details = t.details ? parseDetails(t.details) : [];
    return {
      ...i,
      title: t.title || i.title,
      ...(i.descriptionHtml !== undefined ? { descriptionHtml: t.description || i.descriptionHtml } : {}),
      ...(i.details !== undefined && details.length ? { details } : {}),
    };
  });
}

export async function localizeCollections<T extends { id: string; title: string; description?: string }>(db: Db, shopId: string, language: string | null, items: T[]): Promise<T[]> {
  if (!language || !items.length) return items;
  const map = await translationsFor(db, shopId, language, "collection", items.map((i) => i.id));
  return items.map((i) => {
    const t = map.get(i.id);
    if (!t) return i;
    return { ...i, title: t.title || i.title, ...(i.description !== undefined ? { description: t.description || i.description } : {}) };
  });
}

export async function localizePage<T extends { id: string; title: string; body: string }>(db: Db, shopId: string, language: string | null, page: T): Promise<T> {
  const t = (await translationsFor(db, shopId, language, "page", [page.id])).get(page.id);
  return t ? { ...page, title: t.title || page.title, body: t.body || page.body } : page;
}

/** The published theme in the buyer's language. */
export async function localizedTheme(db: Db, shop: { id: string; name: string }, language: string | null) {
  const doc = await getPublishedTheme(db, shop);
  if (!language) return doc;
  return translateTheme(doc, (await translationsFor(db, shop.id, language, "theme", [shop.id])).get(shop.id));
}
