import { useState } from "react";
import { Text, View } from "react-native";
import { useApi } from "../src/api";
import { money } from "../src/format";
import { useCan, useSession } from "../src/session";
import { BackLink, Body, Card, EmptyState, Heading, List, LoadError, Loading, Row, Screen, Section, Segmented, Stat } from "../src/ui";
import { color, space } from "../src/theme";

type Totals = { salesMinor: number; orders: number; averageOrderMinor: number; visitors: number | null; conversion: number | null };
type Report = {
  days: number;
  compare: "previous" | "year";
  now: Totals;
  before: Totals;
  byDay: { date: string; salesMinor: number; orders: number }[];
  funnel: { step: string; count: number }[];
  topProducts: { productId: string | null; title: string; units: number; salesMinor: number; views: number }[];
  salesBySource: { source: string; orders: number; salesMinor: number }[];
  sources: { source: string; visitors: number }[];
  busiest: { day: string; part: string } | null;
};
type Days = "7" | "30" | "90";

/** "Up 18%", "Down 5%", "Same", or "New" when there was nothing before; as on the website. */
function change(now: number, before: number) {
  if (before <= 0) return now > 0 ? "New" : "";
  const c = (now - before) / before;
  const p = Math.round(Math.abs(c) * 100);
  return p === 0 ? "Same" : `${c > 0 ? "Up" : "Down"} ${p}%`;
}
const pct = (x: number | null) => (x === null ? "–" : `${(Math.round(x * 1000) / 10).toString()}%`);

/** How the store is doing: sales, orders and visitors over a week, a month or three, against the days before. */
export default function AnalyticsScreen() {
  const cur = useSession().me?.shop.currency ?? "USD";
  const can = useCan();
  const [days, setDays] = useState<Days>("7");
  const [compare, setCompare] = useState<"previous" | "year">("previous");
  const data = useApi<Report>(`analytics?days=${days}&compare=${compare}`);
  const r = data.data;
  const versus = compare === "year" ? "vs the same days last year" : `vs the ${days} days before`;
  const most = r ? Math.max(1, ...r.byDay.map((d) => d.salesMinor)) : 1;
  return (
    <Screen title="Analytics" back={<BackLink href="/" label="Today" />} onRefresh={data.reload} refreshing={data.loading && !!r}>
      <Segmented
        label="Days"
        value={days}
        onChange={setDays}
        options={[
          ["7", "7 days"],
          ["30", "30 days"],
          ["90", "90 days"],
        ]}
      />
      <Segmented
        label="Compare with"
        value={compare}
        onChange={setCompare}
        options={[
          ["previous", "Days before"],
          ["year", "Last year"],
        ]}
      />
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!r ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <List>
            <View style={{ flexDirection: "row", gap: 1 }}>
              <Stat label={`Sales · ${change(r.now.salesMinor, r.before.salesMinor) || "–"}`} value={money(r.now.salesMinor, cur)} />
              <Stat label={`Orders · ${change(r.now.orders, r.before.orders) || "–"}`} value={String(r.now.orders)} />
            </View>
            <View style={{ flexDirection: "row", gap: 1 }}>
              <Stat label={`Visitors · ${r.before.visitors === null ? "–" : change(r.now.visitors ?? 0, r.before.visitors) || "–"}`} value={String(r.now.visitors ?? 0)} />
              <Stat label="Bought (of visitors)" value={pct(r.now.conversion)} />
            </View>
          </List>
          <Body muted>{`Changes are ${versus}. Sales are after refunds. Average order ${money(r.now.averageOrderMinor, cur)}.`}</Body>

          {r.now.orders ? (
            <Card>
              <Heading>Sales by day</Heading>
              <View role="img" aria-label={`Sales by day, highest ${money(most, cur)}`} style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: 80 }}>
                {r.byDay.map((d) => (
                  <View key={d.date} style={{ flex: 1, height: `${Math.max(2, Math.round((d.salesMinor / most) * 100))}%`, backgroundColor: d.salesMinor ? color.accent : color.border, borderRadius: 2 }} />
                ))}
              </View>
              {r.busiest ? <Body muted>{`Most orders come in on ${r.busiest.day}s, ${r.busiest.part}. Send campaigns a little before then.`}</Body> : null}
            </Card>
          ) : (
            <EmptyState heading="No sales in these days" body="Share your store link, or start a sale, and the numbers show up here." />
          )}

          <Section title="From visit to order">
            <List>
              {r.funnel.map((f, i) => {
                const first = r.funnel[0]!.count;
                return <Row key={f.step} title={f.step} right={<Text style={{ color: color.ink }}>{`${f.count}${i && first ? ` · ${pct(f.count / first)}` : ""}`}</Text>} />;
              })}
            </List>
          </Section>

          {r.topProducts.length ? (
            <Section title="Best sellers">
              <List>
                {r.topProducts.map((p) => (
                  <Row key={p.productId ?? p.title} href={p.productId ? (`/products/${p.productId}` as never) : undefined} title={p.title} subtitle={`${p.units} sold · ${p.views} views`} right={<Text style={{ color: color.ink }}>{money(p.salesMinor, cur)}</Text>} />
                ))}
              </List>
            </Section>
          ) : null}

          {r.salesBySource.length ? (
            <Section title="What each source sold">
              <List>
                {r.salesBySource.map((x) => (
                  <Row key={x.source} title={x.source} subtitle={`${x.orders} ${x.orders === 1 ? "order" : "orders"}`} right={<Text style={{ color: color.ink }}>{money(x.salesMinor, cur)}</Text>} />
                ))}
              </List>
            </Section>
          ) : null}

          {r.sources.length ? (
            <Section title="Where visitors came from">
              <List>
                {r.sources.map((x) => (
                  <Row key={x.source} title={x.source} right={<Text style={{ color: color.ink }}>{`${x.visitors} ${x.visitors === 1 ? "visitor" : "visitors"}`}</Text>} />
                ))}
              </List>
              <Body muted>Add ?utm_source=instagram to the links you post to see each one here.</Body>
            </Section>
          ) : null}
          {can("marketing") ? (
            <List>
              <Row href="/survey" title="How buyers found you" subtitle="The buyer survey on the order page, and what they answered" />
            </List>
          ) : null}
          <View style={{ height: space(4) }} />
        </>
      )}
    </Screen>
  );
}
