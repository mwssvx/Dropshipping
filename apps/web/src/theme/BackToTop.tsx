"use client";
import { useEffect, useState } from "react";

/**
 * A corner button that appears once a shopper is two screens down a long page. It scrolls back
 * up (at once for shoppers who ask for less motion) and moves keyboard focus to the header.
 */
export function BackToTop({ label }: { label: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const check = () => setShown(window.scrollY > window.innerHeight * 2);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);
  if (!shown) return null;
  const up = () => {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
    document.querySelector<HTMLElement>("header a, header button")?.focus({ preventScroll: true });
  };
  return (
    <button type="button" onClick={up}
      className="sf-back-to-top fixed left-4 bottom-20 sm:bottom-6 z-30 inline-flex items-center gap-1.5 rounded-full bg-ink text-surface px-4 py-2.5 text-sm font-semibold shadow-lg hover:opacity-90 print:hidden">
      <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden><path d="M10 4l6 6-1.4 1.4L11 7.8V16H9V7.8L5.4 11.4 4 10z" /></svg>
      {label}
    </button>
  );
}
