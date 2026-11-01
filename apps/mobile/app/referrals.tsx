import { useState } from "react";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen, Section, Toggle } from "../src/ui";

type Data = {
  currency: string;
  program: { friendPercentOff: number; reward: string; min: string } | null;
  friends: number;
  orders: number;
  salesMinor: number;
  creditMinor: number;
};

/** Refer a friend: buyers share a link, friends get a first-order code, and the buyer gets store credit once that order is delivered. */
export default function ReferralsScreen() {
  const data = useApi<Data>("referrals");
  const [form, setForm] = useState<{ on: boolean; percentOff: string; reward: string; min: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const f = form ?? (d ? { on: !!d.program, percentOff: String(d.program?.friendPercentOff ?? 10), reward: d.program?.reward ?? "10.00", min: d.program?.min ?? "" } : null);

  async function save() {
    if (!f) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("referrals", { method: "PUT", body: f });
      setNote({ tone: "success", text: r.message });
      setForm(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Refer a friend" back={<BackLink href="/codes" label="Discount codes" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !f ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Card>
            <Body muted>Buyers get a link to share on their order page and account. A friend who opens it gets a code by email for their first order. When that order is delivered, the buyer who shared the link gets store credit as a gift card, so you never pay credit on an order that's refunded or charged back.</Body>
            <Toggle label="Let buyers refer friends" value={f.on} onChange={(v) => setForm({ ...f, on: v })} />
            {f.on ? (
              <>
                <Field label="Friend's percent off" value={f.percentOff} onChangeText={(v) => setForm({ ...f, percentOff: v })} keyboardType="number-pad" />
                <Field label={`Credit for the buyer (${d.currency})`} value={f.reward} onChangeText={(v) => setForm({ ...f, reward: v })} keyboardType="decimal-pad" />
                <Field label={`Friend's minimum order (${d.currency})`} value={f.min} onChangeText={(v) => setForm({ ...f, min: v })} keyboardType="decimal-pad" placeholder="Optional" />
              </>
            ) : null}
            <Button label="Save refer a friend" busy={busy} disabled={busy || !form} onPress={() => void save()} />
          </Card>
          <Section title="Results">
            <Body>{`${d.friends} ${d.friends === 1 ? "friend" : "friends"} sent a code · ${d.orders} ${d.orders === 1 ? "order" : "orders"} · ${money(d.salesMinor, d.currency)} in sales`}</Body>
            <Body muted>{`${money(d.creditMinor, d.currency)} credit given to buyers who shared`}</Body>
          </Section>
        </>
      )}
    </Screen>
  );
}
