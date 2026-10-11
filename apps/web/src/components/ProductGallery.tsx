"use client";
import { useEffect, useState } from "react";
import type { ProductVideo } from "@sf/core";

/**
 * The store's product photos: one large, with thumbnails to switch between them. Picking an option
 * that has its own photo (the red one) shows that photo: the option picker sends it as an
 * "sf:photo" event, and a plain option list marks its choices with data-photo. A product video comes
 * after the photos; YouTube and Vimeo only load once the buyer presses play. Each photo is described
 * by the merchant's text for it, else by the product's name.
 */
export function ProductGallery({ title, photos, alts, video, text }: { title: string; photos: string[]; alts?: Record<string, string>; video?: ProductVideo | null; text?: { video: string; play: string } }) {
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const words = text ?? { video: "Video", play: "Play video" };
  const count = photos.length + (video ? 1 : 0);
  const onVideo = !!video && current === photos.length;
  // The product's own photo, so nothing is fetched from YouTube or Vimeo before play.
  const poster = photos[0];
  const pick = (i: number) => {
    setCurrent(i);
    setPlaying(false);
  };
  useEffect(() => {
    const show = (url: unknown) => {
      const i = typeof url === "string" ? photos.indexOf(url) : -1;
      if (i >= 0) {
        setCurrent(i);
        setPlaying(false);
      }
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
      <div className="sf-media aspect-square rounded-xl bg-sunken overflow-hidden relative">
        {onVideo ? (
          video.kind === "file" ? (
            <video src={video.url} poster={photos[0]} controls playsInline preload="metadata" className="size-full object-contain bg-ink" aria-label={`${title}, ${words.video}`} />
          ) : playing ? (
            <iframe src={video.embedUrl} title={`${title}, ${words.video}`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen className="size-full border-0" />
          ) : (
            <button type="button" onClick={() => setPlaying(true)} className="group size-full relative bg-ink" aria-label={words.play}>
              {poster && <img src={poster} alt="" className="size-full object-cover opacity-90" />}
              <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
                <span className="size-16 rounded-full bg-surface/90 text-ink flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                  <svg viewBox="0 0 20 20" className="size-7 ml-1" fill="currentColor"><path d="M6 4l10 6-10 6z" /></svg>
                </span>
              </span>
            </button>
          )
        ) : (
          shown && <img src={shown} alt={alts?.[shown] || (photos.length > 1 ? `${title}, photo ${current + 1} of ${photos.length}` : title)} width={800} height={800} fetchPriority="high" className="size-full object-cover" />
        )}
      </div>
      {count > 1 && (
        <ul className="grid grid-cols-5 gap-2" aria-label="More photos">
          {photos.map((src, i) => (
            <li key={src}>
              <button type="button" onClick={() => pick(i)} aria-label={`Show photo ${i + 1}`} aria-current={i === current}
                className={`sf-media block aspect-square w-full rounded-lg overflow-hidden bg-sunken border-2 ${i === current ? "border-ink" : "border-transparent hover:border-border-strong"}`}>
                <img src={src} alt="" loading="lazy" className="size-full object-cover" />
              </button>
            </li>
          ))}
          {video && (
            <li>
              <button type="button" onClick={() => pick(photos.length)} aria-label={words.video} aria-current={onVideo}
                className={`sf-media relative block aspect-square w-full rounded-lg overflow-hidden bg-ink border-2 ${onVideo ? "border-ink" : "border-transparent hover:border-border-strong"}`}>
                {poster && <img src={poster} alt="" loading="lazy" className="size-full object-cover opacity-80" />}
                <span className="absolute inset-0 flex items-center justify-center text-surface" aria-hidden>
                  <svg viewBox="0 0 20 20" className="size-6 drop-shadow" fill="currentColor"><path d="M6 4l10 6-10 6z" /></svg>
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
