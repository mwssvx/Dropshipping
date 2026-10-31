import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../../src/api";
import { FULFILMENT, money, when } from "../../src/format";
import { useSession } from "../../src/session";
import { BackLink, Banner, Body, Button, Card, Field, List, LoadError, Loading, Pill, Row, Screen, Section, Stat } from "../../src/ui";

type Profile = {
  id: string;
  name: string | null;
  email: string;
  note: string | null;
  tags: string[];
  stats: { orders: number; spentMinor: number; refundedMinor: number; averageMinor: number; firstOrderAt: string | null; lastOrderAt: string | null };
  storeCreditMinor: number;
  orders: { id: string; number: number; paidAt: string | null; totalMinor: number; refundedMinor: number; currency: string; fulfillmentStatus: string; items: number }[];
};

/** One customer: what they've bought, and the store's own note and tags about them. */
export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useApi<Profile>(`customers/${id}`);
  const cur = useSession().me?.shop.currency ?? "USD";
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const p = profile.data;
  useEffect(() => {
    if (!p) return;
    setNote(p.note ?? "");
    setTags(p.tags.join(", "));
  }, [p]);

  const back = <BackLink href="/customers" label="Customers" />;
  if (!p) return <Screen title="Customer" back={back}>{profile.loading ? <Loading /> : <LoadError error={profile.error} stale={false} retry={profile.reload} />}</Screen>;

  const changed = note.trim() !== (p.note ?? "") || tags.split(",").map((t) => t.trim()).filter(Boolean).join(", ") !== p.tags.join(", ");
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`customers/${id}`, { method: "PATCH", body: { note, tags } });
      setMsg({ tone: "success", text: "Saved." });
      await profile.reload();
    } catch (e) {
      setMsg({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={p.name || p.email} back={back} onRefresh={profile.reload} refreshing={profile.loading}>
      {p.name ? <Body muted>{p.email}</Body> : null}
      <List>
        <View style={{ flexDirection: "row", gap: 1 }}>
          <Stat label="Orders" value={String(p.stats.orders)} />
          <Stat label="Spent" value={money(p.stats.spentMinor, cur)} />
        </View>
        <View style={{ flexDirection: "row", gap: 1 }}>
          <Stat label="Average order" value={p.stats.orders ? money(p.stats.averageMinor, cur) : "–"} />
          <Stat label="Store credit" value={money(p.storeCreditMinor, cur)} />
        </View>
      </List>
      {p.stats.firstOrderAt ? <Body muted>{`First order ${when(p.stats.firstOrderAt)}, latest ${when(p.stats.lastOrderAt)}.`}</Body> : null}

      <Section title="Orders">
        {p.orders.length ? (
          <List>
            {p.orders.map((o) => {
              const f = FULFILMENT[o.fulfillmentStatus] ?? { label: o.fulfillmentStatus, tone: "neutral" as const };
              return (
                <Row
                  key={o.id}
                  href={`/orders/${o.id}` as never}
                  title={`Order #${o.number}`}
                  subtitle={`${money(o.totalMinor - o.refundedMinor, o.currency)} · ${o.items} ${o.items === 1 ? "item" : "items"}${o.paidAt ? ` · ${when(o.paidAt)}` : ""}`}
                  right={<Pill label={f.label} tone={f.tone} />}
                />
              );
            })}
          </List>
        ) : (
          <Body muted>No paid orders yet.</Body>
        )}
      </Section>

      <Section title="Your note and tags">
        <Card>
          {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
          <Field label="Note" value={note} onChangeText={setNote} multiline placeholder="Only your team sees this" />
          <Field label="Tags" value={tags} onChangeText={setTags} autoCapitalize="none" placeholder="vip, wholesale" hint="Separate tags with commas. Codes and campaigns can go to a tag." />
          {changed ? <Button label="Save note and tags" busy={busy} onPress={save} /> : null}
        </Card>
      </Section>
    </Screen>
  );
}
