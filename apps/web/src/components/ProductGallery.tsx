"use client";
import { useEffect, useState } from "react";

/**
 * The store's product photos: one large, with thumbnails to switch between them. Picking an option
 * that has its own photo (the red one) shows that photo: the option picker sends it as an
 * "sf:photo" event, and a plain option list marks its choices with data-photo.
 */
export function ProductGallery({ title, photos }: { title: string; photos: string[] }) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const show = (url: unknown) => {
      const i = typeof url === "string" ? photos.indexOf(url) : -1;
      if (i >= 0) setCurrent(i);
    };
    const onPhoto = (e: Event) => show((e as CustomEvent).detail);
    const onChange = (e: Event) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && el.name === "variantId" && el.checked) show(el.dataset.photo);
    };
    window.addEventListener("sf:photo", onPhoto);
    document.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("sf:photo", onPhoto);
      document.removeEventListener("change", onChange);
    };
  }, [photos]);
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
