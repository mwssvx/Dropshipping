"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

/**
 * A header menu item that opens a list of links. It closes on Escape, on a click elsewhere,
 * when focus moves out of it, and when a link in it is followed.
 */
export function MenuDropdown({ label, href, links }: { label: string; href: string; links: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const all = href ? [{ label, href }, ...links] : links;
  return (
    <div ref={box} className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={button} type="button" className="inline-flex items-center gap-1 hover:text-accent" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {label}
        <svg viewBox="0 0 20 20" className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} fill="currentColor" aria-hidden><path d="M5.3 7.3L10 12l4.7-4.7 1.4 1.4L10 14.8 3.9 8.7z" /></svg>
      </button>
      <ul id={id} className={`absolute left-0 top-full mt-2 min-w-48 card p-2 flex-col z-20 shadow-lg font-normal ${open ? "flex" : "hidden"}`}>
        {all.map((l, i) => (
          <li key={i}>
            <Link href={l.href} className="block px-3 py-2 rounded-md hover:bg-sunken whitespace-nowrap" onClick={() => setOpen(false)}>{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
