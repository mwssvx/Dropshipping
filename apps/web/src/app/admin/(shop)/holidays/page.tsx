import Link from "next/link";
import { holidayChecklist } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Holiday checklist" };

/** Everything worth setting up before Black Friday and Christmas, ticked from the store's own settings. */
export default async function HolidaysPage() {
  const { shop, db } = await requireShop("home");
  const checks = await holidayChecklist(db, shop);
  const left = checks.filter((c) => !c.done).length;
  return (
    <main className="pb-12">
      <PageHeader title="Holiday checklist" />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-3xl">
        <p className="hint">
          The busiest weeks of the year, ready in an afternoon. Each line ticks itself once it&apos;s set up, and links to where you do it.
        </p>
        <p className="font-medium" role="status">{left === 0 ? "All set for the holidays." : `${checks.length - left} of ${checks.length} done`}</p>
        <ol className="card divide-y divide-border">
          {checks.map((c) => (
            <li key={c.key} aria-label={`${c.title}: ${c.done ? "done" : "to do"}`}>
              <Link href={c.href} className="flex gap-3 items-start p-4 hover:bg-sunken">
                <span aria-hidden className={`mt-0.5 size-4 shrink-0 rounded-full border-2 grid place-items-center ${c.done ? "bg-accent border-accent" : "border-border-strong"}`}>
                  {c.done && <svg viewBox="0 0 12 12" className="size-2.5 text-accent-ink" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.2 2.2 4.8-5" /></svg>}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className={`text-sm font-medium ${c.done ? "text-muted" : ""}`}>{c.title}</span>
                  <span className="text-sm hint">{c.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
