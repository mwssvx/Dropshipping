import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { api, useApi } from "../../src/api";
import { money, when } from "../../src/format";
import { useSession } from "../../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, List, LoadError, Loading, Pill, Row, Screen, Segmented, Stat } from "../../src/ui";
import { space } from "../../src/theme";

type Sub = {
  id: string;
  email: string;
  name: string;
  status: "active" | "paused" | "cancelled";
  pausedBy: "buyer" | "payment" | null;
  failures: number;
  lastError: string | null;
  every: string;
  percentOff: number;
  nextOrderAt: string;
  items: string[];
  deliveries: number;
  salesMinor: number;
  firstOrderId: string;
  firstOrderNumber: number | null;
};
type Data = { stats: { active: number; orders: number; salesMinor: number }; testMode: boolean; subscriptions: Sub[] };
type Show = "active" | "failing" | "paused" | "all";

const EMPTY: Record<Show, [string, string]> = {
  active: ["No subscriptions yet", "Turn on subscribe and save under Marketing on the website, and buyers can get their order again every few weeks for a little less."],
  failing: ["No card problems", "When a buyer's card is declined for a delivery, it shows up here."],
  paused: ["Nothing paused", "Buyers can pause their subscription from the link in their emails."],
  all: ["No subscriptions yet", "Buyers can subscribe from their order page after paying, once subscribe and save is on."],
};

const state = (s: Sub): [string, "success" | "warning" | "critical" | "neutral"] =>
  s.status === "cancelled"
    ? ["Cancelled", "neutral"]
    : s.status === "paused"
      ? [s.pausedBy === "payment" ? "Paused: card declined" : "Paused by the buyer", s.pausedBy === "payment" ? "critical" : "warning"]
      : s.failures > 0
        ? ["Card declined, trying again", "warning"]
        : ["Active", "success"];

/** Buyers who get their order again every few weeks: who, what, when next, and what they've spent. */
export default function SubscriptionsScreen() {
  const cur = useSession().me?.shop.currency ?? "USD";
  const [show, setShow] = useState<Show>("active");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const [done, setDone] = useState<string | null>(null);
  const data = useApi<Data>(`subscriptions?show=${show}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const d = data.data;
  return (
    <Screen title="Subscriptions" back={<BackLink href="/orders" label="Orders" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {d ? (
        <View style={{ flexDirection: "row", gap: 1 }}>
          <Stat label="Active" value={String(d.stats.active)} />
          <Stat label="Repeat deliveries" value={String(d.stats.orders)} />
          <Stat label="They brought in" value={money(d.stats.salesMinor, cur)} />
        </View>
      ) : null}
      <Field label="Search by email" value={query} onChangeText={setQuery} autoCapitalize="none" keyboardType="email-address" />
      <Segmented
        label="Which subscriptions"
        value={show}
        onChange={setShow}
        options={[
          ["active", "Active"],
          ["failing", "Card problems"],
          ["paused", "Paused"],
          ["all", "All"],
        ]}
      />
      {done ? <Banner tone="success">{done}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : d.subscriptions.length === 0 ? (
        q ? <EmptyState heading="No subscription matches" body={`No subscriber's email has "${q}" in it.`} /> : <EmptyState heading={EMPTY[show][0]} body={EMPTY[show][1]} />
      ) : (
        d.subscriptions.map((s) => (
          <SubCard
            key={s.id}
            sub={s}
            cur={cur}
            testMode={d.testMode}
            onDone={async (text) => {
              setDone(text);
              await data.reload();
            }}
          />
        ))
      )}
    </Screen>
  );
}

function SubCard({ sub: s, cur, testMode, onDone }: { sub: Sub; cur: string; testMode: boolean; onDone: (message: string) => Promise<unknown> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(action: "cancel" | "send_now") {
    setBusy(action);
    setError(null);
    try {
      const r = await api<{ message: string }>(`subscriptions/${s.id}`, { body: { action } });
      setConfirm(false);
      await onDone(r.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const [label, tone] = state(s);
  return (
    <Card>
      <View role="article" aria-label={`${s.name}'s subscription`} style={{ gap: space(2) }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
          <Heading>{s.name}</Heading>
          <Pill label={label} tone={tone} />
        </View>
        <Body>{s.items.join("\n")}</Body>
        <Body muted>{`${s.every}, ${s.percentOff}% off${s.status === "active" ? ` · next on ${when(s.nextOrderAt)}` : ""}`}</Body>
        <Body muted>{`${s.deliveries} ${s.deliveries === 1 ? "delivery" : "deliveries"} so far · ${money(s.salesMinor, cur)}`}</Body>
        {s.lastError && s.status !== "cancelled" && s.failures > 0 ? <Body muted>{`Last try: ${s.lastError}`}</Body> : null}
        {error ? <Banner tone="critical">{error}</Banner> : null}
        <List>
          {s.firstOrderNumber ? <Row href={`/orders/${s.firstOrderId}` as never} title={`First order #${s.firstOrderNumber}`} /> : null}
          <Row title={s.email} subtitle="Write to them" onPress={() => void Linking.openURL(`mailto:${s.email}`)} />
        </List>
        {s.status !== "cancelled" ? (
          confirm ? (
            <>
              <Body>No more deliveries are sent and their card isn't charged again. We email them that you cancelled it.</Body>
              <Button label={`Cancel ${s.name}'s subscription`} kind="danger" busy={busy === "cancel"} onPress={() => run("cancel")} />
              <Button label="Keep it" kind="ghost" onPress={() => setConfirm(false)} />
            </>
          ) : (
            <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
              <Button label="Cancel it…" kind="ghost" a11y={`Cancel ${s.name}'s subscription…`} disabled={!!busy} onPress={() => setConfirm(true)} />
              {testMode && s.status === "active" ? <Button label="Test mode: send the next delivery now" kind="secondary" busy={busy === "send_now"} disabled={!!busy} onPress={() => run("send_now")} /> : null}
            </View>
          )
        ) : null}
      </View>
    </Card>
  );
}
