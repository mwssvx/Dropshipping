// Client-safe: the storefront's chat widget imports this directly.

/** Products a shopping-assistant answer links to, as [title](/products/handle). Anything else stays text. */
export function shopperLinks(reply: string): ({ text: string } | { text: string; handle: string })[] {
  const parts: ({ text: string } | { text: string; handle: string })[] = [];
  const re = /\[([^\]\n]{1,120})\]\(\/products\/([a-z0-9-]{1,200})\)/g;
  let at = 0;
  for (const m of reply.matchAll(re)) {
    if (m.index > at) parts.push({ text: reply.slice(at, m.index) });
    parts.push({ text: m[1]!, handle: m[2]! });
    at = m.index + m[0].length;
  }
  if (at < reply.length) parts.push({ text: reply.slice(at) });
  return parts;
}
