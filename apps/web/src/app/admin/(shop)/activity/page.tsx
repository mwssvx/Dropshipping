import Link from "next/link";
import { listActivity, listTeam } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Activity" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ person?: string; before?: string }> }) {
  const { shop, db } = await requireShop("team");
  const { person, before } = await searchParams;
  const since = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : undefined;
  const [{ entries, next }, { members }] = await Promise.all([listActivity(db, shop.id, { userId: person || undefined, before: since }), listTeam(db, shop.id)]);
  const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  const days: { label: string; items: typeof entries }[] = [];
  for (const e of entries) {
    const label = day(e.createdAt);
    if (days.at(-1)?.label !== label) days.push({ label, items: [] });
    days.at(-1)!.items.push(e);
  }
  const link = (q: Record<string, string | undefined>) => {
    const params = new URLSearchParams(Object.entries(q).filter((kv): kv is [string, string] => !!kv[1]));
    return `/admin/activity${params.size ? `?${params}` : ""}`;
  };

  return (
    <main className="pb-12">
      <PageHeader title="Activity" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <p className="hint">
          What people on your team did: refunds, product and price changes, orders sent or changed, discount codes, the team, API keys and
          store settings. Kept for a little over a year. Times are UTC.
        </p>
        {members.length > 1 && (
          <nav className="flex flex-wrap gap-1" aria-label="Whose activity">
            <Link href={link({})} aria-current={!person ? "page" : undefined} className={`btn btn-sm ${!person ? "btn-primary" : "btn-secondary"}`}>Everyone</Link>
            {members.map((m) => (
              <Link
                key={m.userId}
                href={link({ person: m.userId })}
                aria-current={person === m.userId ? "page" : undefined}
                className={`btn btn-sm ${person === m.userId ? "btn-primary" : "btn-secondary"}`}
              >
                {m.name || m.email}
              </Link>
            ))}
          </nav>
        )}
        {days.length === 0 ? (
          <p className="card p-6 hint">{since ? "Nothing earlier." : "Nothing yet. Refunds, product changes and other things people on your team do will show here."}</p>
        ) : (
          days.map((d) => (
            <section key={d.label} className="flex flex-col gap-2" aria-label={d.label}>
              <h2 className="text-sm font-semibold text-muted">{d.label}</h2>
              <ol className="card divide-y divide-border">
                {d.items.map((e) => (
                  <li key={e.id} className="flex gap-3 px-4 py-3 text-sm">
                    <span className="num hint w-16 shrink-0">{time(e.createdAt)}</span>
                    <span className="min-w-0">
                      <span className="font-medium">{e.email}</span>{" "}
                      {e.href ? <Link href={e.href} className="hover:underline">{lower(e.summary)}</Link> : lower(e.summary)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
        {next && (
          <div>
            <Link href={link({ person, before: next.toISOString() })} className="btn btn-secondary">Older</Link>
          </div>
        )}
      </div>
    </main>
  );
}

/** "Refunded $12.00" reads as "someone@x.com refunded $12.00" after the name. */
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
