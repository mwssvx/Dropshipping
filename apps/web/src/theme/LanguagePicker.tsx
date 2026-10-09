"use client";
import { usePathname } from "next/navigation";

/**
 * Links to this same page in each language the store offers. It reads the address in the browser,
 * because the store's layout stays put while the buyer moves between pages. Plain links on purpose:
 * a switch loads the page afresh, so nothing already shown in the other language is reused.
 */
export function LanguagePicker({ root, current, options, label }: { root: string; current: string; options: { code: string; name: string }[]; label: string }) {
  const pathname = usePathname() ?? "/";
  let rest = root && pathname.startsWith(root) ? pathname.slice(root.length) : pathname;
  if (current !== "en" && (rest === `/${current}` || rest.startsWith(`/${current}/`))) rest = rest.slice(current.length + 1);
  if (rest === "/") rest = "";
  return (
    <nav aria-label={label} className="flex items-center gap-2 flex-wrap">
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><circle cx="10" cy="10" r="7.5" /><path d="M2.5 10h15M10 2.5c2.2 2.3 2.2 12.7 0 15M10 2.5c-2.2 2.3-2.2 12.7 0 15" /></svg>
      {options.map((o) => (
        <a key={o.code} href={`${root}${o.code === "en" ? "" : `/${o.code}`}${rest}` || "/"} hrefLang={o.code} lang={o.code}
          aria-current={o.code === current ? "true" : undefined} className={o.code === current ? "font-semibold text-ink" : "hover:text-accent"}>
          {o.name}
        </a>
      ))}
    </nav>
  );
}
