"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * "Added to your cart" with buttons to the cart and checkout, for stores that keep shoppers on
 * the page after adding. It shows once per add: the ?added=1 mark comes off the address at once.
 */
export function AddedToCart({ base, text }: { base: string; text: { added: string; viewCart: string; checkOut: string; close: string } }) {
  const params = useSearchParams();
  const path = usePathname();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (params.get("added") !== "1") return;
    setShown(true);
    const next = new URLSearchParams(params.toString());
    next.delete("added");
    const q = next.toString();
    window.history.replaceState(window.history.state, "", `${path}${q ? `?${q}` : ""}${window.location.hash}`);
  }, [params, path]);
  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(false), 8000);
    return () => window.clearTimeout(timer);
  }, [shown]);
  return (
    <div role="status" className="fixed z-40 top-3 inset-x-3 sm:left-auto sm:right-4 sm:w-80">
      {shown && (
        <div className="card p-4 shadow-lg flex flex-col gap-3 bg-surface">
          <div className="flex items-start gap-2">
            <svg viewBox="0 0 20 20" className="size-5 shrink-0 text-accent" fill="currentColor" aria-hidden><path d="M8 13.6L4.4 10l-1.4 1.4L8 16.4 17 7.4 15.6 6z" /></svg>
            <p className="flex-1 font-medium">{text.added}</p>
            <button type="button" className="hint hover:text-ink" onClick={() => setShown(false)} aria-label={text.close}>✕</button>
          </div>
          <div className="flex gap-2">
            <Link href={`${base}/cart`} className="btn btn-secondary flex-1">{text.viewCart}</Link>
            <Link href={`${base}/checkout`} className="btn btn-primary flex-1">{text.checkOut}</Link>
          </div>
        </div>
      )}
    </div>
  );
}
