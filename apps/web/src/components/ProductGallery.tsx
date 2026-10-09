"use client";
import { useState } from "react";

/** The store's product photos: one large, with thumbnails to switch between them. */
export function ProductGallery({ title, photos }: { title: string; photos: string[] }) {
  const [current, setCurrent] = useState(0);
  const shown = photos[current] ?? photos[0];
  return (
    <div className="flex flex-col gap-3">
      <div className="sf-media aspect-square rounded-xl bg-sunken overflow-hidden">
        {shown && <img src={shown} alt={photos.length > 1 ? `${title}, photo ${current + 1} of ${photos.length}` : title} width={800} height={800} fetchPriority="high" className="size-full object-cover" />}
      </div>
      {photos.length > 1 && (
        <ul className="grid grid-cols-5 gap-2" aria-label="More photos">
          {photos.map((src, i) => (
            <li key={src}>
              <button type="button" onClick={() => setCurrent(i)} aria-label={`Show photo ${i + 1}`} aria-current={i === current}
                className={`sf-media block aspect-square w-full rounded-lg overflow-hidden bg-sunken border-2 ${i === current ? "border-ink" : "border-transparent hover:border-border-strong"}`}>
                <img src={src} alt="" loading="lazy" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
