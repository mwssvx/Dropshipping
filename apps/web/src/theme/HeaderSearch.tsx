"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { SearchSuggest } from "./SearchSuggest";

type Labels = Parameters<typeof SearchSuggest>[0]["labels"] & { placeholder: string; close: string };

/**
 * The header's search button. It opens a search box under the header, with suggestions as the
 * buyer types, so shoppers can search from any page. Without JavaScript it's a link to the
 * search page. Escape (once the suggestions are closed) or Close puts it away again.
 */
export function HeaderSearch({ action, labels }: { action: string; labels: Labels }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLAnchorElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    // A click outside the header puts it away.
    const away = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.("[data-header-search]")) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return (
    <div data-header-search className="static">
      <Link ref={toggle} href={action} className="p-2 hover:text-accent block" aria-label={labels.search} aria-expanded={open} aria-controls={id}
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}>
        <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4.5 4.5" strokeLinecap="round" /></svg>
      </Link>
      {open && (
        <div id={id} className="absolute left-0 right-0 top-full z-30 border-b border-border bg-surface shadow-md"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !e.defaultPrevented) close();
          }}>
          <form action={action} method="get" role="search" aria-label={labels.search} className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex gap-2">
            <SearchSuggest suggestUrl={`${action}/suggest`} defaultValue="" placeholder={labels.placeholder} autoFocus labels={labels} />
            <button className="btn btn-primary">{labels.search}</button>
            <button type="button" className="btn btn-secondary" onClick={close}>{labels.close}</button>
          </form>
        </div>
      )}
    </div>
  );
}
