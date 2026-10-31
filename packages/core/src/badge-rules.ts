// The badges a product card shows, worked out from the product alone. Kept apart from the database
// code so the storefront's sections can use it in the browser too (the theme editor's preview).
import type { BadgeSettings } from "@sf/db";

export const DEFAULT_BADGES: BadgeSettings = { sale: true, soldOut: true, newDays: 0 };
export const BADGE_MAX_LENGTH = 20;

export type Badge = { kind: "custom"; text: string } | { kind: "sold_out" } | { kind: "sale"; percent: number } | { kind: "new" };

/** What a product card needs to know to pick its badges. */
export type BadgeFacts = { badge?: string | null; priceMinor: number; compareAtMinor?: number | null; createdAt?: Date | string | null; soldOut?: boolean };

/** The badges for one product card, most important first, two at most. */
export function cardBadges(settings: BadgeSettings | null | undefined, p: BadgeFacts, now = new Date()): Badge[] {
  const s = settings ?? DEFAULT_BADGES;
  const out: Badge[] = [];
  if (p.badge?.trim()) out.push({ kind: "custom", text: p.badge.trim() });
  if (p.soldOut) {
    if (s.soldOut) out.push({ kind: "sold_out" });
  } else if (s.sale && p.compareAtMinor && p.compareAtMinor > p.priceMinor) {
    // Rounded down, so the badge never promises more off than the price gives.
    const percent = Math.floor(((p.compareAtMinor - p.priceMinor) / p.compareAtMinor) * 100);
    if (percent >= 1) out.push({ kind: "sale", percent });
  }
  if (s.newDays > 0 && p.createdAt && now.getTime() - new Date(p.createdAt).getTime() < s.newDays * 86_400_000) out.push({ kind: "new" });
  return out.slice(0, 2);
}

/** Fold-out notes a store can put under every product (shipping, returns, care). */
export const PRODUCT_INFO_MAX = 4;
export const PRODUCT_INFO_TITLE_MAX = 60;
export const PRODUCT_INFO_TEXT_MAX = 1500;
