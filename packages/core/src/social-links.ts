// Links from a store's footer to its pages on social networks. No database or Node imports, so
// the theme editor can check a link while the merchant types it.

/** The networks a store can link to, in the order their icons show. */
export const SOCIAL_NETWORKS = {
  instagram: { label: "Instagram", hosts: ["instagram.com"], profile: (h: string) => `https://www.instagram.com/${h}` },
  facebook: { label: "Facebook", hosts: ["facebook.com", "fb.com"], profile: (h: string) => `https://www.facebook.com/${h}` },
  tiktok: { label: "TikTok", hosts: ["tiktok.com"], profile: (h: string) => `https://www.tiktok.com/@${h}` },
  youtube: { label: "YouTube", hosts: ["youtube.com"], profile: (h: string) => `https://www.youtube.com/@${h}` },
  pinterest: { label: "Pinterest", hosts: ["pinterest.com", "pinterest.co.uk", "pinterest.ca", "pinterest.de", "pinterest.fr", "pinterest.es", "pinterest.it"], profile: (h: string) => `https://www.pinterest.com/${h}` },
  x: { label: "X", hosts: ["x.com", "twitter.com"], profile: (h: string) => `https://x.com/${h}` },
} as const;
export type SocialNetwork = keyof typeof SOCIAL_NETWORKS;
export const SOCIAL_KEYS = Object.keys(SOCIAL_NETWORKS) as SocialNetwork[];

/**
 * What the merchant typed, as a full link: "@name" becomes the profile's address, a link
 * without https:// gets it, and http:// is upgraded. Anything else is left for the check.
 */
export function socialHref(network: SocialNetwork, input: string) {
  const text = input.trim();
  const handle = /^@([A-Za-z0-9._-]{1,60})$/.exec(text);
  if (handle) return SOCIAL_NETWORKS[network].profile(handle[1]!);
  if (/^http:\/\//i.test(text)) return `https://${text.slice(7)}`;
  if (/^(www\.|m\.)?[a-z0-9-]+(\.[a-z]{2,})+\//i.test(text)) return `https://${text}`;
  return text;
}

/** Whether a link is an https address of a page on the network's own site, not just its home page. */
export function isSocialLink(network: SocialNetwork, href: string) {
  if (href === "") return true;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  const own = SOCIAL_NETWORKS[network].hosts.some((h) => host === h || host.endsWith(`.${h}`));
  return own && url.pathname.replace(/\/+$/, "") !== "";
}

/** The merchant-facing reason a link was refused. */
export function socialLinkProblem(network: SocialNetwork) {
  const n = SOCIAL_NETWORKS[network];
  return `Paste the link to your ${n.label} page, like ${n.profile("yourstore")}, or type @yourstore.`;
}

/** The store's filled-in links, in icon order. */
export function socialLinks(links: Partial<Record<SocialNetwork, string>> | undefined) {
  return SOCIAL_KEYS.flatMap((k) => (links?.[k] ? [{ network: k, label: SOCIAL_NETWORKS[k].label, href: links[k]! }] : []));
}
