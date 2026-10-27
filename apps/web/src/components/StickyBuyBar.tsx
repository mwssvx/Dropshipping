"use client";
import { useEffect, useState } from "react";

/**
 * On phones, once the buyer scrolls past the product's Add to cart button (into the photos,
 * details or reviews), a bar at the bottom of the screen keeps it in reach. Its button submits the
 * same form, so the option and quantity picked above are what's added. Other platforms sell this
 * as a theme app.
 *
 * It repeats a button that's already on the page for people scrolling with a finger, so it's
 * hidden from screen readers and skipped by the keyboard, which reach the real one.
 */
export function StickyBuyBar({ formId, title, imageUrl, label }: { formId: string; title: string; imageUrl: string | null; label: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!form) return;
    // Shown only once the form (its button is last) has gone off the top of the screen, not before the buyer reaches it.
    const watch = new IntersectionObserver(([entry]) => setShown(!entry!.isIntersecting && entry!.boundingClientRect.top < 0));
    watch.observe(form);
    return () => watch.disconnect();
  }, [formId]);
  // Room at the foot of the page so the bar doesn't cover the end of it.
  useEffect(() => {
    if (!shown) return;
    document.body.classList.add("max-sm:pb-20");
    return () => document.body.classList.remove("max-sm:pb-20");
  }, [shown]);
  return (
    <div
      data-sticky-buy
      aria-hidden="true"
      className={shown ? "flex sm:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-4 py-3 items-center gap-3 shadow-lg" : "hidden"}
    >
      {imageUrl && <img src={imageUrl} alt="" className="size-10 rounded-md object-cover shrink-0" />}
      <span className="flex-1 min-w-0 truncate font-medium text-sm">{title}</span>
      <button type="submit" form={formId} tabIndex={-1} className="btn btn-primary">{label}</button>
    </div>
  );
}
