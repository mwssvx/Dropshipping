// Store search beyond products: collections, pages and blog posts whose title has every word the
// buyer typed, for the search page and search as you type. Titles are matched in the store's own
// language and in the buyer's, so "Lampes" finds the Lamps collection on the French store.
import { and, asc, desc, eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { translationsFor } from "./languages";
import { plainSearchText, searchWords } from "./search";

export type SearchLink = { kind: "collection" | "page" | "post"; title: string; path: string; imageUrl: string | null };

const LIMIT = 4;

/** How well titles match the words: 0 when one word is missing, more when words start title words. */
function titleScore(terms: string[], titles: string[]) {
  const text = titles.map(plainSearchText).join(" ");
  const starts = text.split(/[^\p{L}\p{N}]+/u);
  let score = 0;
  for (const t of terms) {
    if (!text.includes(t)) return 0;
    score += starts.some((w) => w.startsWith(t)) ? 3 : 2;
  }
  return score;
}

function best<T>(items: T[], score: (i: T) => number, limit: number) {
  return items
    .map((item, position) => ({ item, position, score: score(item) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, limit)
    .map((r) => r.item);
}

/** Up to four collections and four pages or blog posts that match the search, best first, titled in the buyer's language. */
export async function searchPages(db: Db, shopId: string, q: string, language: string | null, limit = LIMIT) {
  const terms = searchWords(q);
  if (!terms.length) return { collections: [] as SearchLink[], pages: [] as SearchLink[] };
  const [collections, pages, posts] = await Promise.all([
    db.query.collections.findMany({ where: eq(schema.collections.shopId, shopId), columns: { id: true, title: true, handle: true, imageUrl: true }, orderBy: asc(schema.collections.createdAt) }),
    db.query.pages.findMany({ where: and(eq(schema.pages.shopId, shopId), eq(schema.pages.published, true)), columns: { id: true, title: true, handle: true }, orderBy: asc(schema.pages.createdAt) }),
    db.query.blogPosts.findMany({ where: and(eq(schema.blogPosts.shopId, shopId), eq(schema.blogPosts.status, "published")), columns: { title: true, handle: true, imageUrl: true }, orderBy: desc(schema.blogPosts.publishedAt) }),
  ]);
  const [collectionNames, pageNames] = await Promise.all([
    translationsFor(db, shopId, language, "collection", collections.map((c) => c.id)),
    translationsFor(db, shopId, language, "page", pages.map((p) => p.id)),
  ]);
  const local = (names: typeof collectionNames, id: string, title: string) => names.get(id)?.title || title;
  const foundCollections = best(collections, (c) => titleScore(terms, [c.title, local(collectionNames, c.id, c.title)]), limit).map(
    (c): SearchLink => ({ kind: "collection", title: local(collectionNames, c.id, c.title), path: `/collections/${c.handle}`, imageUrl: c.imageUrl }),
  );
  const writing = [
    ...pages.map((p) => ({ kind: "page" as const, titles: [p.title, local(pageNames, p.id, p.title)], title: local(pageNames, p.id, p.title), path: `/pages/${p.handle}`, imageUrl: null })),
    ...posts.map((p) => ({ kind: "post" as const, titles: [p.title], title: p.title, path: `/blog/${p.handle}`, imageUrl: p.imageUrl })),
  ];
  const foundPages = best(writing, (p) => titleScore(terms, p.titles), limit).map((p): SearchLink => ({ kind: p.kind, title: p.title, path: p.path, imageUrl: p.imageUrl }));
  return { collections: foundCollections, pages: foundPages };
}
