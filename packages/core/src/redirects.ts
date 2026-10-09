// Redirects: old store links that keep working. Renaming a product's web address adds one, and
// merchants moving from another platform can paste their old links. A redirect is only used when
// nothing on the store answers that address, so it never hides a real page.
import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { toHandle } from "./handles";

export const MAX_REDIRECTS = 2000;
const MAX_PATH = 500;

/** Addresses the store always answers itself, so they can't be sent elsewhere. */
const RESERVED = /^\/(cart|checkout|account|orders|pay|api|admin|search|subscribe|unsubscribe|verified|r)(\/|$)/;

/** A store path from a pasted address: just the path, lowercased, without a trailing slash. */
export function storePath(input: string) {
  let s = input.trim();
  if (/^https?:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname;
    } catch {
      throw new UserError(`"${input.trim()}" isn't a web address.`);
    }
  }
  s = s.split(/[?#]/)[0]!.replace(/\/{2,}/g, "/").toLowerCase();
  if (!s.startsWith("/")) s = `/${s}`;
  if (s.length > 1) s = s.replace(/\/+$/, "");
  if (s.length > MAX_PATH) throw new UserError("That address is too long.");
  if (/\s/.test(s)) throw new UserError(`"${input.trim()}" has spaces in it.`);
  return s;
}

/** Where a redirect goes: a store path, or a full https address on another site. */
export function redirectTarget(input: string) {
  const s = input.trim();
  if (/^https:\/\//i.test(s)) {
    try {
      return new URL(s).toString();
    } catch {
      throw new UserError(`"${s}" isn't a web address.`);
    }
  }
  if (/^http:\/\//i.test(s)) throw new UserError("Send redirects to an https address.");
  return storePath(s);
}

function checkFrom(from: string) {
  if (from === "/") throw new UserError("Your home page can't be redirected.");
  if (RESERVED.test(from)) throw new UserError(`${from} is used by your store's cart, checkout or accounts, so it can't be redirected.`);
}

export async function listRedirects(db: Db, shopId: string) {
  return db.query.redirects.findMany({ where: eq(schema.redirects.shopId, shopId), orderBy: asc(schema.redirects.fromPath) });
}

async function count(db: Db, shopId: string) {
  const [row] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.redirects).where(eq(schema.redirects.shopId, shopId));
  return row?.n ?? 0;
}

export async function addRedirect(db: Db, shopId: string, input: { from: string; to: string }) {
  const from = storePath(input.from);
  const to = redirectTarget(input.to);
  checkFrom(from);
  if (from === to) throw new UserError("A redirect can't point to itself.");
  if ((await count(db, shopId)) >= MAX_REDIRECTS) throw new UserError(`A store can have up to ${MAX_REDIRECTS} redirects.`);
  const [row] = await db.insert(schema.redirects).values({ shopId, fromPath: from, toPath: to }).onConflictDoNothing().returning();
  if (!row) throw new UserError(`There's already a redirect from ${from}.`);
  return row;
}

/**
 * Many at once, one per line: the old address, then where it goes, separated by a space, a comma
 * or a tab. A header row from a spreadsheet is skipped. Returns what was added and why lines weren't.
 */
export async function addRedirects(db: Db, shopId: string, text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new UserError("Paste at least one line: the old address, then where it should go.");
  if (lines.length > 500) throw new UserError("Add up to 500 redirects at a time.");
  let added = 0;
  const skipped: { line: string; reason: string }[] = [];
  for (const [i, line] of lines.entries()) {
    const parts = line.split(/[\s,\t]+/).filter(Boolean);
    if (i === 0 && /^(redirect\s*)?from\b/i.test(line)) continue;
    if (parts.length !== 2) {
      skipped.push({ line, reason: "Needs two addresses: old, then new." });
      continue;
    }
    try {
      await addRedirect(db, shopId, { from: parts[0]!, to: parts[1]! });
      added++;
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      skipped.push({ line, reason: e.message });
    }
  }
  return { added, skipped };
}

export async function deleteRedirect(db: Db, shopId: string, id: string) {
  const [row] = await db
    .delete(schema.redirects)
    .where(and(eq(schema.redirects.id, id), eq(schema.redirects.shopId, shopId)))
    .returning({ id: schema.redirects.id });
  if (!row) throw new NotFoundError("Redirect");
}

/** The store couldn't answer this path: where it should go instead, if anywhere. Counts the visit. */
export async function findRedirect(db: Db, shopId: string, path: string, opts: { count?: boolean; now?: Date } = {}) {
  let from: string;
  try {
    from = storePath(path);
  } catch {
    return null;
  }
  const where = and(eq(schema.redirects.shopId, shopId), eq(schema.redirects.fromPath, from));
  if (opts.count === false) {
    const row = await db.query.redirects.findFirst({ where, columns: { toPath: true } });
    return row?.toPath ?? null;
  }
  const now = opts.now ?? new Date();
  const [row] = await db
    .update(schema.redirects)
    .set({ hits: sql`${schema.redirects.hits} + 1`, lastHitAt: now })
    .where(where)
    .returning({ to: schema.redirects.toPath });
  return row?.to ?? null;
}

/**
 * Changes a product's web address. The old one keeps working through a redirect, and redirects
 * that pointed at the old address now point straight at the new one.
 */
export async function changeProductHandle(db: Db, shopId: string, productId: string, input: string) {
  if (!/[a-z0-9]/i.test(input)) throw new UserError("Enter a web address using letters and numbers.");
  // Accept a pasted full address or path too: only the last part is the product's.
  const handle = toHandle(input.trim().replace(/\/+$/, "").split("/").pop()!);
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)) });
  if (!product) throw new NotFoundError("Product");
  if (product.handle === handle) return product;
  const taken = await db.query.products.findFirst({
    where: and(eq(schema.products.shopId, shopId), eq(schema.products.handle, handle)),
    columns: { id: true },
  });
  if (taken) throw new UserError(`Another product already uses /products/${handle}.`);
  const oldPath = `/products/${product.handle}`;
  const newPath = `/products/${handle}`;
  return db.transaction(async (tx) => {
    const [row] = await tx.update(schema.products).set({ handle, updatedAt: new Date() }).where(eq(schema.products.id, product.id)).returning();
    // The new address is a real page now, so a redirect from it would never be used.
    await tx.delete(schema.redirects).where(and(eq(schema.redirects.shopId, shopId), eq(schema.redirects.fromPath, newPath)));
    await tx.update(schema.redirects).set({ toPath: newPath }).where(and(eq(schema.redirects.shopId, shopId), eq(schema.redirects.toPath, oldPath)));
    await tx
      .insert(schema.redirects)
      .values({ shopId, fromPath: oldPath, toPath: newPath })
      .onConflictDoUpdate({ target: [schema.redirects.shopId, schema.redirects.fromPath], set: { toPath: newPath } });
    return row!;
  });
}
