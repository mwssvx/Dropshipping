import Link from "next/link";
import { analyticsReport, BUSIEST_MIN_ORDERS, comparisonRange, CUTOFF_TIME_ZONES, defaultCutoffZone, formatMoney, periodChange, periodTotals, searchReport, whenBuyersBuy, type Comparison } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Analytics" };

const DAY = 86_400_000;
const RANGES = [7, 30, 90] as const;

/** "Up 18%", "Down 5%" or "Same", or "New" when there was nothing before; null when there's nothing either side. */
function changeLabel(now: number, before: number) {
  const c = periodChange(now, before);
  if (c === null) return now > 0 ? "New" : null;
  const p = Math.round(Math.abs(c) * 100);
  return p === 0 ? "Same" : `${c > 0 ? "Up" : "Down"} ${p}%`;
}

/** Conversion moves in percentage points: "Up 0.4 pts". */
function pointsLabel(now: number | null, before: number | null) {
  if (now === null || before === null) return null;
  const pts = Math.round((now - before) * 1000) / 10;
  return pts === 0 ? "Same" : `${pts > 0 ? "Up" : "Down"} ${Math.abs(pts)} pts`;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string; compare?: string; tz?: string }> }) {
  const { shop, db } = await requireShop("analytics");
  const { days: wanted, compare: wantedCompare, tz } = await searchParams;
  const days = RANGES.find((d) => String(d) === wanted) ?? 30;
  const compare: Comparison = wantedCompare === "year" ? "year" : "previous";
  const now = new Date();
  const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY;
  const range = { from: new Date(to - days * DAY), to: new Date(to) };
  const zone = CUTOFF_TIME_ZONES.find(([z]) => z === tz)?.[0] ?? shop.shipCutoff?.timeZone ?? defaultCutoffZone(shop.country);
  const [r, before, searches, store, when] = await Promise.all([
    analyticsReport(db, shop.id, range),
    periodTotals(db, shop.id, comparisonRange(range, compare), now),
    searchReport(db, shop.id, range),
    storeAddress(shop),
    whenBuyersBuy(db, shop.id, range, zone),
  ]);
  // The period and comparison links keep a picked time zone.
  const tzParam = zone === tz ? `&tz=${encodeURIComponent(zone)}` : "";
  const busiestDay = Math.max(1, ...when.byDay.map((d) => d.orders));
  const busiestPart = Math.max(1, ...when.byPart.map((p) => p.orders));
  const versus = compare === "year" ? "vs the same days last year" : `vs the ${days} days before`;
  const searchLink = (term: string) => `${store}/search?q=${encodeURIComponent(term)}`;
  const money = (m: number) => formatMoney(m, shop.currency);
  const pct = (x: number | null) => (x === null ? "–" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
  const top = Math.max(1, ...r.days.map((d) => d.salesMinor));
  const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const first = r.funnel[0]!.count;

  return (
    <main className="pb-12">
      <PageHeader
        title="Analytics"
        actions={
          <nav className="flex gap-1" aria-label="Period">
            {RANGES.map((d) => (
              <Link key={d} href={`/admin/analytics?days=${d}${compare === "year" ? "&compare=year" : ""}${tzParam}`} aria-current={d === days ? "page" : undefined} className={`btn ${d === days ? "btn-primary" : "btn-secondary"}`}>
                {d} days
              </Link>
            ))}
          </nav>
        }
      />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-5xl">
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Compare with">
          <span className="hint">Compare with</span>
          {(["previous", "year"] as const).map((c) => (
            <Link key={c} href={`/admin/analytics?days=${days}&compare=${c}${tzParam}`} aria-current={c === compare ? "page" : undefined} className={`pill ${c === compare ? "pill-success" : ""}`}>
              {c === "year" ? "Same days last year" : `The ${days} days before`}
            </Link>
          ))}
        </nav>
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {(
            [
              ["Sales", money(r.salesMinor), changeLabel(r.salesMinor, before.salesMinor)],
              ["Orders", String(r.orders), changeLabel(r.orders, before.orders)],
              ["Average order", r.orders ? money(r.averageOrderMinor) : "–", r.orders && before.orders ? changeLabel(r.averageOrderMinor, before.averageOrderMinor) : null],
              ["Visitors", String(r.visitors), before.visitors === null ? null : changeLabel(r.visitors, before.visitors)],
              ["Conversion", pct(r.conversion), pointsLabel(r.conversion, before.conversion)],
            ] as const
          ).map(([k, v, c]) => (
            <div key={k} className="card p-4">
              <dt className="hint">{k}</dt>
              <dd className="text-xl font-semibold num">{v}</dd>
              {c && <dd className={`text-xs num ${c.startsWith("Up") || c === "New" ? "text-success" : c.startsWith("Down") ? "text-critical" : "hint"}`}>{c} <span className="hint">{versus}</span></dd>}
            </div>
          ))}
        </dl>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="sales-heading">
          <h2 id="sales-heading" className="font-semibold">Sales by day</h2>
          {r.salesMinor === 0 ? (
            <p className="hint">No sales in the last {days} days yet.</p>
          ) : (
            <figure className="flex flex-col gap-1">
              <div className="flex items-end gap-px h-40" role="img" aria-label={`Sales for each of the last ${days} days, highest ${money(top)}`}>
                {r.days.map((d) => (
                  <div key={d.date} className="flex-1 h-full flex items-end group relative" title={`${label(d.date)}: ${money(d.salesMinor)}, ${d.orders} ${d.orders === 1 ? "order" : "orders"}, ${d.visitors} visitors`}>
                    <div className="w-full rounded-t-sm bg-accent/80 group-hover:bg-accent" style={{ height: `${Math.max(d.salesMinor ? 2 : 0, (d.salesMinor / top) * 100)}%` }} />
                  </div>
                ))}
              </div>
              <figcaption className="flex justify-between hint text-xs">
                <span>{label(r.days[0]!.date)}</span>
                <span>Today</span>
              </figcaption>
            </figure>
          )}
        </section>

        {when.orders > 0 && (
          <section className="card p-5 flex flex-col gap-3" aria-labelledby="when-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="when-heading" className="font-semibold">When buyers buy</h2>
              <form action="/admin/analytics#when-heading" className="flex items-center gap-2 text-sm">
                <input type="hidden" name="days" value={days} />
                {compare === "year" && <input type="hidden" name="compare" value="year" />}
                <label htmlFor="when-tz" className="hint">Time zone</label>
                <select id="when-tz" name="tz" defaultValue={when.timeZone} className="input">
                  {CUTOFF_TIME_ZONES.map(([z, name]) => <option key={z} value={z}>{name}</option>)}
                </select>
                <button className="btn btn-secondary btn-sm">Show</button>
              </form>
            </div>
            <p className="text-sm">
              {when.busiest
                ? <>Most orders come in on <strong>{when.busiest.day}s, {when.busiest.part}</strong>. Send campaigns and start ads a little before then.</>
                : <span className="hint">The busiest time shows once there are {BUSIEST_MIN_ORDERS} orders in the period.</span>}
            </p>
            <div className="grid gap-6 sm:grid-cols-2">
              {(
                [
                  ["By day of the week", when.byDay.map((d) => [d.day, d.orders] as const), busiestDay],
                  ["By time of day", when.byPart.map((p) => [p.part, p.orders] as const), busiestPart],
                ] as const
              ).map(([title, bars, most]) => (
                <div key={title} className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">{title}</h3>
                  <ul className="flex flex-col gap-1.5" aria-label={title}>
                    {bars.map(([name, n]) => (
                      <li key={name} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-sm" aria-label={`${name}: ${n} ${n === 1 ? "order" : "orders"}`}>
                        <span className="hint">{name}</span>
                        <span className="h-2 rounded-full bg-sunken overflow-hidden"><span className="block h-full bg-accent" style={{ width: `${(n / most) * 100}%` }} /></span>
                        <span className="num text-right">{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card p-5 flex flex-col gap-3" aria-labelledby="funnel-heading">
            <h2 id="funnel-heading" className="font-semibold">From visit to sale</h2>
            <ol className="flex flex-col gap-2">
              {r.funnel.map((s, i) => {
                const prev = i ? r.funnel[i - 1]!.count : null;
                return (
                  <li key={s.step} className="flex flex-col gap-1 text-sm">
                    <div className="flex justify-between gap-2">
                      <span>{s.step}</span>
                      <span className="num">
                        {s.count}
                        {prev ? <span className="hint"> · {pct(Math.min(1, s.count / prev))} of previous</span> : null}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-sunken overflow-hidden">
                      <div className="h-full bg-accent" style={{ width: `${first ? Math.min(100, (s.count / first) * 100) : 0}%` }} />
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="hint text-xs">A visitor is one visit; it ends after 30 minutes without activity. We don't track people across visits.</p>
          </section>

          <section className="card p-5 flex flex-col gap-3" aria-labelledby="sources-heading">
            <h2 id="sources-heading" className="font-semibold">Where visitors came from</h2>
            {r.sources.length ? (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {r.sources.map((s) => (
                  <li key={s.source} className="flex justify-between py-2"><span>{s.source}</span><span className="num">{s.visitors}</span></li>
                ))}
              </ul>
            ) : (
              <p className="hint">No visitors yet. Share your store link to get started.</p>
            )}
          </section>
        </div>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="source-sales-heading">
          <h2 id="source-sales-heading" className="font-semibold">Sales by source</h2>
          {r.salesBySource.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left hint">
                    <th className="font-normal py-2">Source</th>
                    <th className="font-normal py-2 text-right">Orders</th>
                    <th className="font-normal py-2 text-right">Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {r.salesBySource.map((s) => (
                    <tr key={s.source}>
                      <td className="py-2">{s.source}</td>
                      <td className="py-2 text-right num">{s.orders}</td>
                      <td className="py-2 text-right num">{money(s.salesMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hint">No sales in this period yet.</p>
          )}
          <p className="hint text-xs">The site or utm_source of the visit each order was placed in. Add ?utm_source=instagram to the links you share to see which posts and ads sell.</p>
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="top-heading">
          <h2 id="top-heading" className="font-semibold">Best sellers</h2>
          {r.topProducts.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left hint">
                    <th className="font-normal py-2">Product</th>
                    <th className="font-normal py-2 text-right">Sold</th>
                    <th className="font-normal py-2 text-right">Sales</th>
                    <th className="font-normal py-2 text-right">Views</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {r.topProducts.map((p) => (
                    <tr key={p.productId ?? p.title}>
                      <td className="py-2">{p.productId ? <Link className="hover:underline" href={`/admin/products/${p.productId}`}>{p.title}</Link> : p.title}</td>
                      <td className="py-2 text-right num">{p.units}</td>
                      <td className="py-2 text-right num">{money(p.salesMinor)}</td>
                      <td className="py-2 text-right num">{p.views}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hint">Your best sellers show here after your first sales.</p>
          )}
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="searches-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="searches-heading" className="font-semibold">What shoppers search for</h2>
            <Link href="/admin/search-fixes" className="text-sm underline">Search fixes</Link>
            {searches.searches > 0 && (
              <p className="hint text-sm">
                {searches.searches === 1 ? "1 search" : `${searches.searches.toLocaleString("en-US")} searches`}, {pct(searches.nothingShare)} found nothing
              </p>
            )}
          </div>
          {searches.searches === 0 ? (
            <p className="hint">Words shoppers type into your store&apos;s search box show here. Only the words are kept, never who searched.</p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Most searched</h3>
                <ol className="text-sm flex flex-col gap-1" aria-label="Most searched">
                  {searches.top.map((s) => (
                    <li key={s.term} className="flex justify-between gap-3">
                      <a href={searchLink(s.term)} target="_blank" rel="noreferrer" className="hover:underline truncate">{s.term}</a>
                      <span className="num hint shrink-0">{s.searches} · {s.results === 1 ? "1 result" : `${s.results} results`}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Found nothing</h3>
                {searches.nothing.length ? (
                  <>
                    <ol className="text-sm flex flex-col gap-1" aria-label="Found nothing">
                      {searches.nothing.map((s) => (
                        <li key={s.term} className="flex justify-between gap-3">
                          <a href={searchLink(s.term)} target="_blank" rel="noreferrer" className="hover:underline truncate">{s.term}</a>
                          <span className="flex gap-3 shrink-0">
                            <span className="num hint">{s.searches === 1 ? "1 search" : `${s.searches} searches`}</span>
                            <Link href={`/admin/search-fixes?from=${encodeURIComponent(s.term)}`} className="underline" aria-label={`Fix the search “${s.term}”`}>Fix</Link>
                          </span>
                        </li>
                      ))}
                    </ol>
                    <p className="hint text-xs">
                      Shoppers wanted these and left empty-handed. Add a product they&apos;d buy, use their words in a product&apos;s title or description, or
                      point the search at words that find something.
                    </p>
                  </>
                ) : (
                  <p className="hint text-sm">Every search found something.</p>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
