"use client";
import { useEffect, useState } from "react";

export type ScrollingTextLabels = { region: string; pause: string; play: string };

const SECONDS = { slow: 40, medium: 25, fast: 15 } as const;

/**
 * Short messages gliding across the page in a loop. The row is drawn twice so the loop has no
 * gap; screen readers hear it once. It stops while the shopper points at it, has a pause button,
 * and for shoppers who ask for less motion it's a still row from the start.
 */
export function ScrollingText({ items, speed, large, labels }: { items: string[]; speed: keyof typeof SECONDS; large: boolean; labels: ScrollingTextLabels }) {
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setStill(true);
  }, []);
  const text = large ? "text-2xl sm:text-4xl font-bold tracking-tight" : "text-base sm:text-lg font-semibold";
  const row = (copy: boolean) => (
    <ul className="flex shrink-0 items-center" aria-hidden={copy || undefined}>
      {items.map((t, i) => (
        <li key={i} className="flex items-center whitespace-nowrap">
          <span className="px-6">{t}</span>
          <span className="text-accent" aria-hidden="true">✦</span>
        </li>
      ))}
    </ul>
  );
  if (still) {
    return (
      <section className={`sf-marquee border-y border-border py-5 ${text}`} aria-label={labels.region}>
        <ul className="flex flex-wrap items-center justify-center gap-y-2 px-4">
          {items.map((t, i) => <li key={i} className="px-4 text-center">{t}</li>)}
        </ul>
      </section>
    );
  }
  return (
    <section className={`sf-marquee relative border-y border-border py-5 overflow-hidden ${text}`} aria-label={labels.region} data-paused={paused || undefined}>
      <div className="sf-marquee-track flex w-max" style={{ animationDuration: `${SECONDS[speed]}s` }}>
        {row(false)}
        {row(true)}
      </div>
      <button type="button" onClick={() => setPaused(!paused)} aria-label={paused ? labels.play : labels.pause}
        className="absolute right-2 top-1/2 -translate-y-1/2 size-8 inline-flex items-center justify-center rounded-full bg-surface/90 text-ink shadow-sm hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent">
        {paused ? (
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden><path d="M6 4l10 6-10 6z" /></svg>
        ) : (
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden><path d="M5 4h3.5v12H5zM11.5 4H15v12h-3.5z" /></svg>
        )}
      </button>
    </section>
  );
}
