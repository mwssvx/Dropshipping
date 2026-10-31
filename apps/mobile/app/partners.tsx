import { useState } from "react";
import { Share, View } from "react-native";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, LoadError, Loading, Pill, Screen, Section } from "../src/ui";
import { space } from "../src/theme";

type Partner = {
  id: string;
  name: string;
  email: string | null;
  code: string;
  percentOff: number;
  commission: string;
  active: boolean;
  orders: number;
  money: { salesMinor: number; pendingMinor: number; earnedMinor: number; paidMinor: number; owedMinor: number } | null;
  shareUrl: string;
  portalUrl: string;
};
type Data = { seesMoney: boolean; holdDays: number; partners: Partner[] };

const EMPTY = { name: "", email: "", code: "", percentOff: "10", commission: "10" };

/**
 * Creators and anyone who promotes the store, each with their own code: what it sold, what they're
 * owed, recording a payment, pausing them, and sharing their code link or private page.
 */
export default function PartnersScreen() {
  const data = useApi<Data>("partners");
  const cur = useSession().me?.shop.currency ?? "USD";
  const [form, setForm] = useState(EMPTY);
  const [paying, setPaying] = useState<{ id: string; amount: string; note: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const set = (k: keyof typeof EMPTY) => (v: string) => setForm({ ...form, [k]: v });

  async function run(key: string, path: string, body: unknown, after?: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { body });
      setNote({ tone: "success", text: r.message });
      after?.();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Partners" back={<BackLink href="/" label="Today" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>{`Buyers get money off with a partner's code, and the partner gets a share of what those orders paid for items. It counts once the order is delivered, or ${d.holdDays} days after it was paid, and refunds come off.`}</Body>
          {d.partners.length === 0 ? <EmptyState heading="No partners yet" body="Add a creator below and give them their code." /> : null}
          {d.partners.map((p) => (
            <Card key={p.id}>
              <View role="group" aria-label={p.name} style={{ gap: space(1) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <Heading>{p.name}</Heading>
                  {!p.active ? <Pill label="Paused" tone="warning" /> : null}
                </View>
                <Body muted>{`Code ${p.code} · buyers get ${p.percentOff}% off · they get ${p.commission}${p.email ? ` · ${p.email}` : ""}`}</Body>
                <Body>{`${p.orders} ${p.orders === 1 ? "order" : "orders"}${p.money ? ` · ${money(p.money.salesMinor, cur)} of items` : ""}`}</Body>
                {p.money ? (
                  <Body muted>{`Owed ${money(p.money.owedMinor, cur)} · waiting to count ${money(p.money.pendingMinor, cur)} · paid ${money(p.money.paidMinor, cur)} so far`}</Body>
                ) : null}
                {paying?.id === p.id ? (
                  <>
                    <Field label="Amount paid" value={paying.amount} onChangeText={(v) => setPaying({ ...paying, amount: v })} keyboardType="decimal-pad" />
                    <Field label="Note (optional)" value={paying.note} onChangeText={(v) => setPaying({ ...paying, note: v })} placeholder="PayPal, March" />
                    <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                      <Button
                        label="Record the payment"
                        busy={busy === `pay:${p.id}`}
                        disabled={!!busy}
                        onPress={() => run(`pay:${p.id}`, `partners/${p.id}/payout`, { amount: paying.amount, note: paying.note }, () => setPaying(null))}
                      />
                      <Button label="Cancel" kind="secondary" onPress={() => setPaying(null)} />
                    </View>
                  </>
                ) : null}
                <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                  <Button label="Share their code link" kind="secondary" a11y={`Share ${p.name}'s code link`} onPress={() => void Share.share({ message: p.shareUrl, url: p.shareUrl })} />
                  <Button label="Share their private page" kind="secondary" a11y={`Share ${p.name}'s private page`} onPress={() => void Share.share({ message: p.portalUrl, url: p.portalUrl })} />
                  {p.money && p.money.owedMinor > 0 && paying?.id !== p.id ? (
                    <Button label="Record a payment" kind="secondary" a11y={`Record a payment to ${p.name}`} onPress={() => setPaying({ id: p.id, amount: (p.money!.owedMinor / 100).toFixed(2), note: "" })} />
                  ) : null}
                  <Button
                    label={p.active ? "Pause" : "Bring back"}
                    kind="secondary"
                    busy={busy === `active:${p.id}`}
                    disabled={!!busy}
                    a11y={`${p.active ? "Pause" : "Bring back"} ${p.name}`}
                    onPress={() => run(`active:${p.id}`, `partners/${p.id}`, { action: p.active ? "pause" : "resume" })}
                  />
                  <Button
                    label="New private link"
                    kind="ghost"
                    busy={busy === `link:${p.id}`}
                    disabled={!!busy}
                    a11y={`Make a new private link for ${p.name}`}
                    onPress={() => run(`link:${p.id}`, `partners/${p.id}`, { action: "new_link" })}
                  />
                </View>
              </View>
            </Card>
          ))}
          <Section title="Add a partner">
            <Card>
              <Field label="Their name" value={form.name} onChangeText={set("name")} placeholder="Maya at @lampsbymaya" />
              <Field label="Their email (optional)" value={form.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" hint="We email them their code and private page." />
              <Field label="Their code" value={form.code} onChangeText={(v) => set("code")(v.toUpperCase())} autoCapitalize="none" placeholder="MAYA10" />
              <Field label="Buyers get (% off)" value={form.percentOff} onChangeText={set("percentOff")} keyboardType="number-pad" />
              <Field label="They get (% of items sold)" value={form.commission} onChangeText={set("commission")} keyboardType="decimal-pad" />
              <Button label="Add partner" busy={busy === "add"} disabled={!!busy || !form.name.trim() || !form.code.trim()} onPress={() => run("add", "partners", form, () => setForm(EMPTY))} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
