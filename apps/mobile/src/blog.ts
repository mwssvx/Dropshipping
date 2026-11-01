/** A blog post as the app lists it. */
export type PostSummary = { id: string; title: string; state: "draft" | "scheduled" | "live"; publishedAt: string | null; updatedAt: string; tags: string[]; url: string };

const at = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const on = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "Draft", "Goes up Nov 27, 9:00 AM" or "Live since Oct 3, 2026". */
export function postState(p: Pick<PostSummary, "state" | "publishedAt">) {
  if (p.state === "scheduled" && p.publishedAt) return `Goes up ${at(p.publishedAt)}`;
  if (p.state === "live" && p.publishedAt) return `Live since ${on(p.publishedAt)}`;
  return "Draft";
}
