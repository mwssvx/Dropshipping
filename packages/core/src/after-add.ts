/*
 * Where a shopper goes after "Add to cart" when the store keeps them on the page: back to the
 * page they added from, with ?added=1 so it can say so. Only a path on the store itself is
 * used, so the Referer header can't send anyone elsewhere.
 */

export const ADDED_PARAM = "added";

/** The page to return to, or null to open the cart instead. */
export function stayPathAfterAdd(referer: string | null | undefined, base: string): string | null {
  if (!referer) return null;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return null;
  }
  const path = url.pathname;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  if (base && path !== base && !path.startsWith(`${base}/`)) return null;
  // Checkout and payment pages aren't places to add from.
  const rest = base ? path.slice(base.length) : path;
  if (/^\/(checkout|pay|orders)(\/|$)/.test(rest)) return null;
  url.searchParams.set(ADDED_PARAM, "1");
  return `${path}?${url.searchParams.toString()}`;
}
