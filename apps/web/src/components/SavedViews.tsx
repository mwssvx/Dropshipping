import Link from "next/link";
import { viewQuery, type SavedView, type SavedViewList } from "@sf/core";
import { deleteViewAction } from "@/app/admin/view-actions";
import { SaveViewForm } from "./SaveViewForm";

/**
 * The team's saved views for a list, as links, and a way to save the current search and filters.
 * `params` is what the list shows now; the view matching it is marked as the current one.
 */
export function SavedViews({ list, views, params }: { list: SavedViewList; views: SavedView[]; params: Record<string, string | undefined> }) {
  const current = viewQuery(list, params);
  const kept = Object.fromEntries([...new URLSearchParams(current)]);
  if (!views.length && !current) return null;
  const mine = views.find((v) => v.query === current);
  return (
    <div className="flex flex-col gap-1">
      {views.length > 0 && (
        <nav className="flex flex-wrap gap-1 items-center" aria-label="Saved views">
          <span className="hint text-sm mr-1">Views</span>
          {views.map((v) => (
            <span key={v.id} className={`chip text-sm inline-flex items-center gap-1 ${v.id === mine?.id ? "font-semibold border-accent" : ""}`}>
              <Link href={`/admin/${list}?${v.query}`} aria-current={v.id === mine?.id ? "page" : undefined}>{v.name}</Link>
              <form action={deleteViewAction.bind(null, list, v.id)}>
                <button className="hint px-1" aria-label={`Remove the view ${v.name}`} title="Remove this view">×</button>
              </form>
            </span>
          ))}
        </nav>
      )}
      {current && !mine && (
        <details className="text-sm">
          <summary className="cursor-pointer underline w-fit">Save this view</summary>
          <SaveViewForm list={list} params={kept} />
        </details>
      )}
    </div>
  );
}
