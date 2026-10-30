// What a pasted video link points at: a YouTube or Vimeo video, or a video file. No database or
// Node imports, so the storefront's section library and the theme editor can use it in the browser.

export type ProductVideo =
  | { kind: "youtube" | "vimeo"; id: string; embedUrl: string }
  | { kind: "file"; url: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** What a pasted video link points at, or null when it isn't one we can play. */
export function parseVideo(raw: string | null | undefined): ProductVideo | null {
  const text = (raw ?? "").trim();
  if (!text || text.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let youtube: string | undefined;
  if (host === "youtu.be") youtube = parts[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    youtube = url.pathname === "/watch" ? url.searchParams.get("v") ?? undefined : ["shorts", "embed", "live"].includes(parts[0] ?? "") ? parts[1] : undefined;
  }
  if (youtube !== undefined) {
    if (!YOUTUBE_ID.test(youtube)) return null;
    return { kind: "youtube", id: youtube, embedUrl: `https://www.youtube-nocookie.com/embed/${youtube}?autoplay=1&rel=0&playsinline=1` };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parts.find((p) => /^\d{6,12}$/.test(p));
    if (!id) return null;
    return { kind: "vimeo", id, embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1` };
  }
  if (/\.(mp4|webm|mov|m4v)$/i.test(url.pathname)) return { kind: "file", url: url.toString() };
  return null;
}
