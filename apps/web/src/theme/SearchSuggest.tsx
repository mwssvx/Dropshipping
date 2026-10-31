"use client";

import { useEffect, useId, useRef, useState } from "react";

type Suggestion = { title: string; url: string; imageUrl: string | null; price: string; compareAt: string | null; soldOut: boolean };
type Found = { kind: "collection" | "page" | "post"; title: string; url: string };

/**
 * The search box, with products suggested as the buyer types, then collections, pages and posts. Without JavaScript it's a plain
 * search field in its form. Arrow keys move through the suggestions, Enter opens one (or runs the
 * search when none is picked), and Escape closes them.
 */
export function SearchSuggest({ suggestUrl, defaultValue, placeholder, autoFocus, labels }: {
  suggestUrl: string;
  defaultValue: string;
  placeholder: string;
  autoFocus: boolean;
  labels: { search: string; suggestions: string; soldOut: string; seeAll: string; kinds: Record<Found["kind"], string> };
}) {
  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [links, setLinks] = useState<Found[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const listId = `${id}-list`;
  const q = value.trim();

  useEffect(() => {
    if (q.length < 2) {
      setItems([]);
      setLinks([]);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${suggestUrl}?${new URLSearchParams({ q })}`, { signal: abort.signal });
        if (!res.ok) return;
        const body = (await res.json()) as { products: Suggestion[]; links?: Found[] };
        setItems(body.products);
        setLinks(body.links ?? []);
        setActive(-1);
      } catch {
        // A newer keystroke took over, or the network dropped: the plain search still works.
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [q, suggestUrl]);

  const shown = open && q.length >= 2 && items.length + links.length > 0;
  // Products, then collections and pages; the last row runs the full search.
  const rows = [...items.map((p) => p.url), ...links.map((l) => l.url)];
  const count = rows.length + 1;
  const go = (i: number) => {
    if (i < rows.length) window.location.assign(rows[i]!);
    else input.current?.form?.requestSubmit();
  };

  return (
    <div className="relative flex-1">
      <label className="sr-only" htmlFor={`${id}-q`}>{labels.search}</label>
      <input
        ref={input}
        className="input w-full"
        id={`${id}-q`}
        name="q"
        type="search"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={200}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!shown) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % count);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? count - 1 : a - 1));
          } else if (e.key === "Escape") {
            // Closes the list first; a second Escape clears the box as usual.
            e.preventDefault();
            setOpen(false);
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            go(active);
          }
        }}
      />
      {shown && (
        <ul
          id={listId}
          role="listbox"
          aria-label={labels.suggestions}
          className="absolute z-30 left-0 right-0 mt-1 card p-1 flex flex-col shadow-lg"
          // Keeps focus in the box, so a click lands before the list closes.
          onMouseDown={(e) => e.preventDefault()}
        >
          {items.map((p, i) => (
            <li key={p.url} id={`${id}-${i}`} role="option" aria-selected={active === i} onClick={() => go(i)} onMouseEnter={() => setActive(i)}
              className={`flex items-center gap-3 px-2 py-2 rounded-md cursor-pointer ${active === i ? "bg-sunken" : ""}`}>
              <span className="size-10 shrink-0 rounded bg-sunken overflow-hidden">
                {p.imageUrl && <img src={p.imageUrl} alt="" width={40} height={40} className="size-full object-cover" />}
              </span>
              <span className="flex-1 min-w-0 truncate">{p.title}</span>
              <span className="num text-sm whitespace-nowrap">
                {p.soldOut ? <span className="hint">{labels.soldOut}</span> : <>{p.price}{p.compareAt && <s className="hint ml-1">{p.compareAt}</s>}</>}
              </span>
            </li>
          ))}
          {links.map((l, k) => {
            const i = items.length + k;
            return (
              <li key={l.url} id={`${id}-${i}`} role="option" aria-selected={active === i} onClick={() => go(i)} onMouseEnter={() => setActive(i)}
                className={`flex items-center gap-3 px-2 py-2 rounded-md cursor-pointer ${active === i ? "bg-sunken" : ""}`}>
                <span className="flex-1 min-w-0 truncate">{l.title}</span>
                <span className="hint text-sm whitespace-nowrap">{labels.kinds[l.kind]}</span>
              </li>
            );
          })}
          <li id={`${id}-${rows.length}`} role="option" aria-selected={active === rows.length} onClick={() => go(rows.length)} onMouseEnter={() => setActive(rows.length)}
            className={`px-2 py-2 rounded-md cursor-pointer text-sm font-medium text-accent ${active === rows.length ? "bg-sunken" : ""}`}>
            {labels.seeAll.split("%s").join(q)}
          </li>
        </ul>
      )}
    </div>
  );
}
