"use client";
import { useState } from "react";
import type { ProductVideo } from "@sf/core/video-link";

/** A home page video. YouTube and Vimeo only load once the shopper presses play. */
export function SectionVideo({ video, cover, title, play }: { video: ProductVideo; cover: string; title: string; play: string }) {
  const [playing, setPlaying] = useState(false);
  if (video.kind === "file") {
    return <video src={video.url} poster={cover || undefined} controls playsInline preload="metadata" className="size-full object-contain bg-ink" aria-label={title} />;
  }
  if (playing) {
    return <iframe src={video.embedUrl} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen className="size-full border-0" />;
  }
  return (
    <button type="button" onClick={() => setPlaying(true)} className="group size-full relative bg-ink" aria-label={play}>
      {cover && <img src={cover} alt="" loading="lazy" decoding="async" className="size-full object-cover opacity-90" />}
      <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
        <span className="size-16 rounded-full bg-surface/90 text-ink flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
          <svg viewBox="0 0 20 20" className="size-7 ml-1" fill="currentColor"><path d="M6 4l10 6-10 6z" /></svg>
        </span>
      </span>
    </button>
  );
}
