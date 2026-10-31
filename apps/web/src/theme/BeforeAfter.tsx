"use client";
import { useState } from "react";

/**
 * Two photos stacked, the "after" one cut off at a handle the shopper drags (or moves with the
 * arrow keys, as it's a plain range slider underneath) to compare them.
 */
export function BeforeAfter({ beforeUrl, afterUrl, before, after, slider }: { beforeUrl: string; afterUrl: string; before: string; after: string; slider: string }) {
  const [split, setSplit] = useState(50);
  return (
    <div className="sf-before-after relative aspect-[4/3] rounded-lg overflow-hidden bg-sunken select-none">
      <img src={beforeUrl} alt={before} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" draggable={false} />
      <img src={afterUrl} alt={after} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" draggable={false}
        style={{ clipPath: `inset(0 0 0 ${split}%)` }} />
      <span className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white" aria-hidden="true">{before}</span>
      <span className="absolute right-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white" aria-hidden="true">{after}</span>
      <span className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow" style={{ left: `${split}%` }} aria-hidden="true">
        <span className="absolute top-1/2 left-1/2 size-9 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white text-ink shadow flex items-center justify-center">
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor"><path d="M7 5L2 10l5 5zM13 5l5 5-5 5z" /></svg>
        </span>
      </span>
      <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label={slider}
        aria-valuetext={`${before} ${split}%, ${after} ${100 - split}%`}
        className="sf-before-after-range absolute inset-0 size-full cursor-ew-resize opacity-0" />
    </div>
  );
}
