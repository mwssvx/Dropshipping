import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../../src/api";
import { FULFILMENT, money, parseMoney, when } from "../../src/format";
import { useCan, useSession } from "../../src/session";
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
  const can = useCan();
  const [credit, setCredit] = useState("");
  const [why, setWhy] = useState("");
  const [crediting, setCrediting] = useState(false);
  const [creditMsg, setCreditMsg] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
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

  async function giveCredit() {
    const amountMinor = parseMoney(credit);
    if (!amountMinor) return setCreditMsg({ tone: "critical", text: "Enter the amount, like 10." });
    setCrediting(true);
    setCreditMsg(null);
    try {
      const r = await api<{ message: string }>(`customers/${id}/credit`, { body: { amountMinor, note: why } });
      setCreditMsg({ tone: "success", text: r.message });
      setCredit("");
      setWhy("");
      await profile.reload();
    } catch (e) {
      setCreditMsg({ tone: "critical", text: (e as Error).message });
    } finally {
      setCrediting(false);
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

      {can("gift_cards") ? (
        <Section title="Give store credit">
          <Card>
            {creditMsg ? <Banner tone={creditMsg.tone}>{creditMsg.text}</Banner> : null}
            <Body muted>To say sorry for a late parcel, or thank a regular. They get a code by email that works at checkout.</Body>
            <Field label="Credit to give" value={credit} onChangeText={setCredit} keyboardType="decimal-pad" placeholder="10.00" />
            <Field label="Why" value={why} onChangeText={setWhy} placeholder="Only your team sees this" />
            <Button label="Give store credit" busy={crediting} disabled={!credit.trim()} onPress={giveCredit} />
          </Card>
        </Section>
      ) : null}

      <RewardPoints id={id!} />

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

/** Reward points, when the store gives them: the balance, and adding or taking some with a note the buyer sees. */
function RewardPoints({ id }: { id: string }) {
  const data = useApi<{ enabled: boolean; points: number }>(`customers/${id}/points`);
  const [points, setPoints] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  if (!d || (!d.enabled && d.points === 0)) return null;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ message: string }>(`customers/${id}/points`, { body: { points, note: why } });
      setMsg({ tone: "success", text: r.message });
      setPoints("");
      setWhy("");
      await data.reload();
    } catch (e) {
      setMsg({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Reward points">
      <Card>
        {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
        <Stat label="Points now" value={d.points.toLocaleString("en-US")} />
        <Field label="Points to add" value={points} onChangeText={setPoints} keyboardType="numbers-and-punctuation" placeholder="200" hint="A minus number takes points away." />
        <Field label="Note they see" value={why} onChangeText={setWhy} placeholder="Sorry about the late parcel" />
        <Button label="Save points" kind="secondary" busy={busy} disabled={busy || !points.trim()} onPress={save} />
      </Card>
    </Section>
  );
}
