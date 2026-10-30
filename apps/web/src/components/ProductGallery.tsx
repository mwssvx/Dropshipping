"use client";
import { useEffect, useRef, useState } from "react";
import type { ProductVideo } from "@sf/core";

export type GalleryText = {
  video: string; play: string; open: string; close: string; previous: string; next: string;
  count: string; zoomIn: string; zoomOut: string; more: string; show: string;
};
const ENGLISH: GalleryText = {
  video: "Video", play: "Play video", open: "Open a larger photo", close: "Close the photos", previous: "Previous photo", next: "Next photo",
  count: "Photo {n} of {count}", zoomIn: "Zoom in", zoomOut: "Zoom out", more: "More photos", show: "Show photo {n}",
};
const VIEWER_BUTTON = "size-10 shrink-0 rounded-full bg-surface/15 hover:bg-surface/25 inline-flex items-center justify-center focus-visible:outline-2 focus-visible:outline-surface";
const fill = (s: string, n: number, count = 0) => s.replace("{n}", String(n)).replace("{count}", String(count));

/**
 * The store's product photos: one large, with thumbnails to switch between them. Picking an option
 * that has its own photo (the red one) shows that photo: the option picker sends it as an
 * "sf:photo" event, and a plain option list marks its choices with data-photo. A product video comes
 * after the photos; YouTube and Vimeo only load once the buyer presses play. Each photo is described
 * by the merchant's text for it, else by the product's name. Pressing the large photo opens it
 * full screen, where the buyer can step through the photos (arrow keys or a swipe) and zoom in.
 */
export function ProductGallery({ title, photos, alts, video, text }: { title: string; photos: string[]; alts?: Record<string, string>; video?: ProductVideo | null; text?: GalleryText }) {
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const words = text ?? ENGLISH;
  const viewer = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState("50% 50%");
  const swipe = useRef<number | null>(null);
  // Set when the last press was a swipe, so letting go does not also zoom.
  const swiped = useRef(false);
  const count = photos.length + (video ? 1 : 0);
  const onVideo = !!video && current === photos.length;
  // The product's own photo, so nothing is fetched from YouTube or Vimeo before play.
  const poster = photos[0];
  const pick = (i: number) => {
    setCurrent(i);
    setPlaying(false);
  };
  // Inside the full-screen view only photos take turns, never the video.
  const step = (d: 1 | -1) => {
    setZoomed(false);
    setCurrent((i) => (Math.min(i, photos.length - 1) + d + photos.length) % photos.length);
  };
  const open = () => {
    setZoomed(false);
    viewer.current?.showModal();
  };
  const aim = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
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
  const big = photos[Math.min(current, photos.length - 1)];
  const alt = (src: string | undefined, i: number) => (src && alts?.[src]) || (photos.length > 1 ? `${title}, photo ${i + 1} of ${photos.length}` : title);
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
          shown && (
            <>
              <img src={shown} alt={alt(shown, current)} width={800} height={800} fetchPriority="high" className="size-full object-cover" />
              {/* Over the photo rather than around it, so the photo keeps its own description. */}
              <button type="button" onClick={open} className="group absolute inset-0 cursor-zoom-in" aria-label={words.open}>
                <span className="absolute right-3 bottom-3 size-9 rounded-full bg-surface/90 text-ink flex items-center justify-center shadow opacity-80 group-hover:opacity-100" aria-hidden>
                  <svg viewBox="0 0 20 20" className="size-5" fill="currentColor"><path d="M8.5 3a5.5 5.5 0 014.4 8.8l3.7 3.7-1.4 1.4-3.7-3.7A5.5 5.5 0 118.5 3zm0 2a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM7.5 6.5h2v1h1v2h-1v1h-2v-1h-1v-2h1z" /></svg>
                </span>
              </button>
            </>
          )
        )}
      </div>
      {count > 1 && (
        <ul className="grid grid-cols-5 gap-2" aria-label={words.more}>
          {photos.map((src, i) => (
            <li key={src}>
              <button type="button" onClick={() => pick(i)} aria-label={fill(words.show, i + 1)} aria-current={i === current}
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
      {photos.length > 0 && (
        <dialog ref={viewer} aria-label={title} onClose={() => setZoomed(false)}
          onKeyDown={(e) => {
            if (photos.length < 2) return;
            if (e.key === "ArrowLeft") step(-1);
            if (e.key === "ArrowRight") step(1);
          }}
          className="m-0 p-0 overscroll-contain size-full max-w-none max-h-none bg-ink text-surface backdrop:bg-ink/80">
          <div className="size-full flex flex-col">
            <div className="flex items-center gap-2 p-3">
              <p className="flex-1 text-sm" aria-live="polite">{photos.length > 1 ? fill(words.count, Math.min(current, photos.length - 1) + 1, photos.length) : title}</p>
              <button type="button" onClick={() => setZoomed(!zoomed)} className={VIEWER_BUTTON} aria-pressed={zoomed} aria-label={zoomed ? words.zoomOut : words.zoomIn}>
                <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden>{zoomed ? <path d="M8.5 3a5.5 5.5 0 014.4 8.8l3.7 3.7-1.4 1.4-3.7-3.7A5.5 5.5 0 118.5 3zm0 2a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM6.5 7.5h4v2h-4z" /> : <path d="M8.5 3a5.5 5.5 0 014.4 8.8l3.7 3.7-1.4 1.4-3.7-3.7A5.5 5.5 0 118.5 3zm0 2a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM7.5 6.5h2v1h1v2h-1v1h-2v-1h-1v-2h1z" />}</svg>
              </button>
              <button type="button" onClick={() => viewer.current?.close()} className={VIEWER_BUTTON} aria-label={words.close}>
                <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden><path d="M5.4 4L10 8.6 14.6 4 16 5.4 11.4 10l4.6 4.6-1.4 1.4-4.6-4.6L5.4 16 4 14.6 8.6 10 4 5.4z" /></svg>
              </button>
            </div>
            <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden px-2 pb-4 sm:px-16 sm:pb-8"
              onPointerDown={(e) => { swipe.current = zoomed ? null : e.clientX; }}
              onPointerUp={(e) => {
                const from = swipe.current;
                swipe.current = null;
                swiped.current = from !== null && Math.abs(e.clientX - from) > 10;
                if (from === null || photos.length < 2) return;
                if (e.clientX - from > 50) step(-1);
                if (from - e.clientX > 50) step(1);
              }}>
              {big && (
                <img src={big} alt={alt(big, Math.min(current, photos.length - 1))} draggable={false}
                  onClick={(e) => { if (swiped.current) return; aim(e); setZoomed(!zoomed); }} onPointerMove={(e) => { if (zoomed) aim(e); }}
                  style={{ transform: zoomed ? "scale(2.5)" : undefined, transformOrigin: origin }}
                  className={`size-full object-contain select-none transition-transform ${zoomed ? "cursor-zoom-out touch-none" : "cursor-zoom-in"}`} />
              )}
              {photos.length > 1 && (
                <>
                  <button type="button" onClick={() => step(-1)} className={`${VIEWER_BUTTON} absolute left-3 top-1/2 -translate-y-1/2`} aria-label={words.previous}>
                    <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden><path d="M12.5 4.5L7 10l5.5 5.5-1.4 1.4L4.2 10l6.9-6.9z" /></svg>
                  </button>
                  <button type="button" onClick={() => step(1)} className={`${VIEWER_BUTTON} absolute right-3 top-1/2 -translate-y-1/2`} aria-label={words.next}>
                    <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden><path d="M7.5 4.5L13 10l-5.5 5.5 1.4 1.4 6.9-6.9-6.9-6.9z" /></svg>
                  </button>
                </>
              )}
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
