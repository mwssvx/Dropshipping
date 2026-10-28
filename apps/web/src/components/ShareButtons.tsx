"use client";
import { useEffect, useState } from "react";

/** shareOn has %s where the site's name goes. */
type Labels = { share: string; copyLink: string; linkCopied: string; shareOn: string };

const SITES = [
  { name: "WhatsApp", href: (url: string, title: string) => `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}` },
  { name: "Facebook", href: (url: string) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
  {
    name: "Pinterest",
    href: (url: string, title: string, image?: string) =>
      `https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(title)}${image ? `&media=${encodeURIComponent(image)}` : ""}`,
  },
] as const;

/**
 * Share buttons for a product page. The link is the page's own address without its query, read
 * in the browser so it's right on a store's own domain too. Phones that can share get one more
 * button that opens their own list of apps.
 */
export function ShareButtons({ title, imageUrl, t }: { title: string; imageUrl?: string | null; t: Labels }) {
  const [url, setUrl] = useState("");
  const [native, setNative] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setUrl(window.location.origin + window.location.pathname);
    setNative(typeof navigator.share === "function");
  }, []);
  const image = imageUrl?.startsWith("/") && url ? new URL(imageUrl, url).href : imageUrl ?? undefined;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      window.prompt(t.copyLink, url);
    }
  };
  return (
    <div className="sf-share flex flex-wrap items-center gap-2 text-sm" role="group" aria-label={t.share}>
      {native && (
        <button type="button" className="chip" onClick={() => navigator.share({ title, url }).catch(() => {})}>
          {t.share}
        </button>
      )}
      <button type="button" className="chip" onClick={copy} disabled={!url}>
        {t.copyLink}
      </button>
      {SITES.map((s) => (
        <a key={s.name} className="chip" href={url ? s.href(url, title, image) : undefined} target="_blank" rel="noopener noreferrer" aria-label={t.shareOn.replace("%s", s.name)}>
          {s.name}
        </a>
      ))}
      {copied && <span role="status" className="hint">{t.linkCopied}</span>}
    </div>
  );
}
