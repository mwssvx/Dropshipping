"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export type Slide = { imageUrl: string; heading: string; text: string; buttonLabel: string; href: string };
export type SlideshowLabels = { slideshow: string; previous: string; next: string; pause: string; play: string; of: string; goTo: string };

const fill = (s: string, n: number, count: number) => s.replace("{n}", String(n)).replace("{count}", String(count));

/**
 * Big slides that take turns, like the announcement bar: it stops while the shopper points at it
 * or tabs into it, has a pause button, and starts paused for shoppers who ask for less motion.
 * Slides not on screen are inert, so keyboards and screen readers skip their buttons.
 */
export function Slideshow({ slides, seconds, height, center, first, labels }: {
  slides: Slide[];
  seconds: number;
  height: string;
  center: boolean;
  first: boolean;
  labels: SlideshowLabels;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [stepped, setStepped] = useState(false);
  const count = slides.length;

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setPaused(true);
  }, []);
  useEffect(() => {
    if (paused || held || count < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [paused, held, count, seconds]);

  const go = (i: number) => {
    setStepped(true);
    setIndex((i + count) % count);
  };
  const button = "size-9 inline-flex items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-white";
  return (
    <section aria-roledescription="carousel" aria-label={labels.slideshow} className="sf-slideshow relative overflow-hidden"
      onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false); }}>
      {/* Every slide sits in the same grid cell, so the tallest one sets the height. */}
      <div className={`grid ${height}`} aria-live={stepped ? "polite" : "off"}>
        {slides.map((s, i) => {
          const on = i === index % count;
          return (
            <div key={i} role="group" aria-roledescription="slide" aria-label={fill(labels.of, i + 1, count)} inert={!on}
              className={`[grid-area:1/1] relative flex items-center transition-opacity duration-700 motion-reduce:transition-none ${on ? "opacity-100" : "opacity-0"} ${s.imageUrl ? "text-white" : "bg-accent-soft"}`}>
              {s.imageUrl && (
                <>
                  <img src={s.imageUrl} alt="" className="absolute inset-0 size-full object-cover" loading={first && i === 0 ? "eager" : "lazy"}
                    fetchPriority={first && i === 0 ? "high" : "auto"} decoding="async" />
                  <div className="absolute inset-0 bg-black/45" aria-hidden />
                </>
              )}
              <div className={`relative max-w-6xl w-full mx-auto px-14 sm:px-16 pt-16 pb-20 flex flex-col gap-4 ${center ? "items-center text-center" : "items-start"}`}>
                {s.heading && <h2 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-3xl">{s.heading}</h2>}
                {s.text && <p className={`text-lg max-w-2xl ${s.imageUrl ? "text-white/90" : "text-muted"}`}>{s.text}</p>}
                {s.buttonLabel && <div className="mt-2"><Link href={s.href} className="btn btn-primary btn-lg">{s.buttonLabel}</Link></div>}
              </div>
            </div>
          );
        })}
      </div>
      {count > 1 && (
        <>
          <button type="button" className={`${button} absolute left-3 top-1/2 -translate-y-1/2`} onClick={() => go(index - 1)} aria-label={labels.previous}>
            <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden><path d="M12.5 4.5L7 10l5.5 5.5-1.4 1.4L4.2 10l6.9-6.9z" /></svg>
          </button>
          <button type="button" className={`${button} absolute right-3 top-1/2 -translate-y-1/2`} onClick={() => go(index + 1)} aria-label={labels.next}>
            <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden><path d="M7.5 4.5L13 10l-5.5 5.5 1.4 1.4 6.9-6.9-6.9-6.9z" /></svg>
          </button>
          <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-2">
            <button type="button" className={button} onClick={() => { if (paused) setHeld(false); setPaused(!paused); }} aria-label={paused ? labels.play : labels.pause}>
              {paused ? (
                <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden><path d="M6 4l10 6-10 6z" /></svg>
              ) : (
                <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden><path d="M5 4h3.5v12H5zM11.5 4H15v12h-3.5z" /></svg>
              )}
            </button>
            {slides.map((_, i) => (
              <button key={i} type="button" onClick={() => go(i)} aria-label={fill(labels.goTo, i + 1, count)} aria-current={i === index % count ? "true" : undefined}
                className={`size-3 rounded-full border-2 border-white ${i === index % count ? "bg-white" : "bg-white/30"} focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2`} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
