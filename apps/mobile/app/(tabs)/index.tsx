import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { useApi } from "../../src/api";
import { setPendingCount } from "../../src/badge";
import { API_URL } from "../../src/config";
import { money } from "../../src/format";
import { ProposalCard, type Proposal } from "../../src/ProposalCard";
import { useCan, useSession } from "../../src/session";
import { Banner, Button, EmptyState, List, LoadError, Loading, Pill, Row, Screen, Section, Stat } from "../../src/ui";
import { space } from "../../src/theme";
import { Link, useRouter } from "expo-router";

type Attention = { kind: string; title: string; body: string; url: string; tone: "critical" | "warning" | "info" };
type Today = { currency: string; salesTodayMinor: number | null; ordersToday: number; sales7dMinor: number | null; orders7d: number; attention: Attention[]; pending: Proposal[] };

// Things the app doesn't do itself open the web admin.
const WEB_ONLY: Record<string, string> = { "/notices": "/admin/trust", "/products#supplier-sold-out": "/admin/products#supplier-sold-out" };

export default function TodayScreen() {
  const { me } = useSession();
  const router = useRouter();
  const today = useApi<Today>("today");
  const can = useCan();
  const [done, setDone] = useState<Record<string, string>>({});
  const t = today.data;
  const pending = (t?.pending ?? []).filter((p) => !done[p.id]);
  useEffect(() => setPendingCount(pending.length), [pending.length]);

  return (
    <Screen
      title="Today"
      onRefresh={today.reload}
      refreshing={today.loading && !!t}
      right={
        <Link href="/settings" accessibilityRole="link" accessibilityLabel="Settings">
          <Pill label={me?.shop.name ?? "Settings"} />
        </Link>
      }
    >
      <LoadError error={today.error} stale={today.stale} retry={today.reload} />
      {!t ? (
        today.loading ? <Loading /> : null
      ) : (
        <>
          <List>
            <View style={{ flexDirection: "row", gap: 1 }}>
              {t.salesTodayMinor !== null && <Stat label="Sales today" value={money(t.salesTodayMinor, t.currency)} />}
              <Stat label="Orders today" value={String(t.ordersToday)} />
            </View>
            <Row title={t.sales7dMinor !== null ? `Last 7 days: ${money(t.sales7dMinor, t.currency)}` : "Last 7 days"} subtitle={`${t.orders7d} ${t.orders7d === 1 ? "order" : "orders"}`} />
          </List>

          <Section title="Needs your attention">
            {t.attention.length === 0 ? (
              <EmptyState heading="All clear" body="Nothing needs you right now. New problems show up here, and on your lock screen if notifications are on." />
            ) : (
              <List>
                {t.attention.map((a) =>
                  WEB_ONLY[a.url] ? (
                    <Row key={a.kind} title={a.title} subtitle={a.body} right={<Pill label="Web ↗" />} onPress={() => Linking.openURL(`${API_URL}${WEB_ONLY[a.url]}`)} />
                  ) : (
                    <Row key={a.kind} title={a.title} subtitle={a.body} right={<Pill label={a.tone === "critical" ? "Fix" : "View"} tone={a.tone} />} href={a.url as never} />
                  ),
                )}
              </List>
            )}
          </Section>

          {can("assistant") && (
            <Section title={`Waiting for your OK${pending.length ? ` (${pending.length})` : ""}`}>
              {Object.entries(done).map(([id, outcome]) => (
                <Banner key={id} tone="success">
                  {outcome}
                </Banner>
              ))}
              {pending.length === 0 ? (
                <EmptyState heading="Nothing waiting" body="When an AI helper wants to change a price, refund an order or write to a buyer, it waits here for you." />
              ) : (
                <View style={{ gap: space(3) }}>
                  {pending.map((p) => (
                    <ProposalCard key={p.id} action={p} onDone={(outcome) => setDone((d) => ({ ...d, [p.id]: outcome }))} />
                  ))}
                </View>
              )}
            </Section>
          )}
          {can("inbox") && <Button label="Buyer inbox" kind="secondary" onPress={() => router.push("/inbox")} />}
          <Button label="Import a product" kind="secondary" onPress={() => router.push("/import")} />
        </>
      )}
    </Screen>
  );
}
