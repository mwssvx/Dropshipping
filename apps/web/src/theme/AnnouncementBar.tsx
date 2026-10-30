"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export type AnnouncementLabels = { previous: string; next: string; pause: string; play: string };

/**
 * An announcement bar whose messages take turns. It stops while the shopper points at it or
 * tabs into it, has a pause button, and starts paused for shoppers who ask for less motion.
 * Pressing play starts it again even with the pointer or focus still on the bar.
 */
export function AnnouncementBar({ messages, seconds, labels }: { messages: { text: string; href: string }[]; seconds: number; labels: AnnouncementLabels }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  // Whether the shopper moved it themselves, so screen readers read the new message out.
  const [stepped, setStepped] = useState(false);
  const count = messages.length;

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setPaused(true);
  }, []);
  useEffect(() => {
    if (paused || held || count < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [paused, held, count, seconds]);

  const step = (d: 1 | -1) => {
    setStepped(true);
    setIndex((i) => (i + d + count) % count);
  };
  const m = messages[index % count]!;
  const body = <span>{m.text}</span>;
  const button = "shrink-0 size-7 inline-flex items-center justify-center rounded hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-current";
  return (
    <div className="bg-accent text-accent-ink text-sm font-medium px-2 py-1 flex items-center gap-1" onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false); }}>
      <button type="button" className={button} onClick={() => step(-1)} aria-label={labels.previous}>
        <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden><path d="M12.5 4.5L7 10l5.5 5.5-1.4 1.4L4.2 10l6.9-6.9z" /></svg>
      </button>
      <div className="flex-1 text-center py-1" aria-live={stepped ? "polite" : "off"} aria-atomic>
        {m.href ? <Link href={m.href} className="hover:underline">{body}</Link> : body}
      </div>
      <button type="button" className={button} onClick={() => { if (paused) setHeld(false); setPaused(!paused); }} aria-label={paused ? labels.play : labels.pause}>
        {paused ? (
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden><path d="M6 4l10 6-10 6z" /></svg>
        ) : (
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden><path d="M5 4h3.5v12H5zM11.5 4H15v12h-3.5z" /></svg>
        )}
      </button>
      <button type="button" className={button} onClick={() => step(1)} aria-label={labels.next}>
        <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden><path d="M7.5 4.5L13 10l-5.5 5.5 1.4 1.4 6.9-6.9-6.9-6.9z" /></svg>
      </button>
    </div>
  );
}
