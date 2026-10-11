// What shoppers search for: each search on the store adds to a count for its words that day, with
// how many products it found. The Analytics page shows the most searched words and the ones that
// found nothing, which point at products to add or words to use in titles. Only the words are
// kept, never who searched, and anything that looks like an email address or a number of six or
// more digits (a phone or card number) isn't kept at all.
//
// Search fixes close the loop: the merchant points words that find nothing ("lampshade") at words
// that do ("lamp shade"), and the store shows those results, saying so.
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { schema, type Db, type SearchFix } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

const DAY = 86_400_000;
export const SEARCH_TERM_MAX = 80;

/** The words as they're counted: lower case, single spaces. Null when they shouldn't be kept. */
export function searchTerm(raw: string | null | undefined) {
  const term = (raw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (term.length < 2 || term.length > SEARCH_TERM_MAX) return null;
  if (term.includes("@") || /\d[\d\s-]{4,}\d/.test(term)) return null;
  return term;
}

/** Counts one search and what it found. */
export async function recordSearch(db: Db, shopId: string, raw: string, results: number, now = new Date()) {
  const term = searchTerm(raw);
  if (!term) return false;
  const day = now.toISOString().slice(0, 10);
  await db
    .insert(schema.searchTerms)
    .values({ shopId, term, day, searches: 1, results })
    .onConflictDoUpdate({
      target: [schema.searchTerms.shopId, schema.searchTerms.term, schema.searchTerms.day],
      set: { searches: sql`${schema.searchTerms.searches} + 1`, results },
    });
  return true;
}

/**
 * The most searched words between two days, and those whose latest search found nothing, with
 * how many searches each had. `from` and `to` are dates; `to` is not included.
 */
export async function searchReport(db: Db, shopId: string, range: { from: Date; to: Date }, limit = 20) {
  const inRange = and(
    eq(schema.searchTerms.shopId, shopId),
    gte(schema.searchTerms.day, range.from.toISOString().slice(0, 10)),
    lt(schema.searchTerms.day, range.to.toISOString().slice(0, 10)),
  );
  const rows = await db
    .select({
      term: schema.searchTerms.term,
      searches: sql<number>`sum(${schema.searchTerms.searches})::int`,
      // What the most recent day's searches found, so a product added since counts.
      results: sql<number>`(array_agg(${schema.searchTerms.results} order by ${schema.searchTerms.day} desc))[1]`,
    })
    .from(schema.searchTerms)
    .where(inRange)
    .groupBy(schema.searchTerms.term)
    .orderBy(desc(sql`sum(${schema.searchTerms.searches})`), schema.searchTerms.term);
  const terms = rows.map((r) => ({ term: r.term, searches: Number(r.searches), results: Number(r.results) }));
  const total = terms.reduce((s, t) => s + t.searches, 0);
  const nothing = terms.filter((t) => t.results === 0);
  return {
    searches: total,
    nothingShare: total ? nothing.reduce((s, t) => s + t.searches, 0) / total : null,
    top: terms.slice(0, limit),
    nothing: nothing.slice(0, limit),
  };
}

/** Deletes search counts older than about 13 months, like visitor events. */
export async function pruneSearchTerms(db: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - 400 * DAY).toISOString().slice(0, 10);
  const gone = await db.delete(schema.searchTerms).where(lt(schema.searchTerms.day, cutoff)).returning({ id: schema.searchTerms.id });
  return gone.length;
}

export const MAX_SEARCH_FIXES = 100;

/** The words to search instead, when the merchant pointed this search elsewhere. */
export function fixedSearch(fixes: SearchFix[], q: string | null | undefined) {
  const term = (q ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return (term && fixes.find((f) => f.from === term)?.to) || null;
}

/** Points a search at other words, replacing an earlier fix for the same search. Gives the store's fixes. */
export async function setSearchFix(db: Db, shopId: string, input: { from: string; to: string }) {
  const from = searchTerm(input.from);
  if (!from) throw new UserError(`Type what shoppers searched for, 2 to ${SEARCH_TERM_MAX} characters.`);
  const to = input.to.toLowerCase().replace(/\s+/g, " ").trim();
  if (!to || to.length > SEARCH_TERM_MAX) throw new UserError(`Type the words to show results for instead, up to ${SEARCH_TERM_MAX} characters.`);
  if (to === from) throw new UserError("Pick different words to show results for.");
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId), columns: { searchFixes: true } });
  if (!shop) throw new NotFoundError("Store");
  const others = shop.searchFixes.filter((f) => f.from !== from);
  if (others.length >= MAX_SEARCH_FIXES) throw new UserError(`A store can have up to ${MAX_SEARCH_FIXES} search fixes. Remove one first.`);
  const searchFixes = [...others, { from, to }].sort((a, b) => a.from.localeCompare(b.from));
  await db.update(schema.shops).set({ searchFixes, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return searchFixes;
}

export async function removeSearchFix(db: Db, shopId: string, from: string) {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId), columns: { searchFixes: true } });
  if (!shop) throw new NotFoundError("Store");
  const searchFixes = shop.searchFixes.filter((f) => f.from !== from);
  await db.update(schema.shops).set({ searchFixes, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return searchFixes;
}
