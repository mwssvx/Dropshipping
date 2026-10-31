import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, View } from "react-native";
import { api, useApi } from "../../src/api";
import { money, when } from "../../src/format";
import { useSession } from "../../src/session";
import { RESTOCK_STATUS } from "../../src/restock";
import { BackLink, Banner, Body, Button, Card, Field, Heading, LoadError, Loading, Pill, Screen, Section } from "../../src/ui";
import { space } from "../../src/theme";

type Detail = {
  id: string;
  number: number;
  supplierName: string;
  supplierEmail: string | null;
  note: string | null;
  expectedOn: string | null;
  status: "open" | "received" | "cancelled";
  createdAt: string;
  receivedAt: string | null;
  ordered: number;
  received: number;
  costMinor: number;
  lines: { id: string; title: string; quantity: number; received: number; unitCostMinor: number | null; productId: string | null }[];
};
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** One restock order: count in what arrived, all of it or some, and the stock goes up. */
export default function RestockOrderScreen() {
  const { id, made } = useLocalSearchParams<{ id: string; made?: string }>();
  const cur = useSession().me?.shop.currency ?? "USD";
  const order = useApi<Detail>(`restock/${id}`);
  const [counting, setCounting] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(made ? { tone: "success", text: made } : null);

  async function run(key: string, path: string, body: unknown) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { body });
      setNote({ tone: "success", text: r.message });
      setCounting(false);
      setConfirm(false);
      setCounts({});
      await order.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const o = order.data;
  const back = <BackLink href="/restock" label="Restock orders" />;
  if (!o) return <Screen title="Restock order" back={back}>{order.loading ? <Loading /> : <LoadError error={order.error} stale={false} retry={order.reload} />}</Screen>;
  const [label, tone] = RESTOCK_STATUS[o.status];
  const waiting = o.lines.filter((l) => l.received < l.quantity);

  return (
    <Screen title={`Restock order #${o.number}`} back={back} onRefresh={order.reload} refreshing={order.loading}>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <Pill label={label} tone={tone} />
      </View>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <Card>
        <Heading>{o.supplierName}</Heading>
        <Body muted>
          {[
            `${o.received} of ${o.ordered} in`,
            o.costMinor ? money(o.costMinor, cur) : null,
            o.status === "open" && o.expectedOn ? `expected ${day.format(new Date(`${o.expectedOn}T12:00:00Z`))}` : null,
            o.receivedAt ? `all in on ${when(o.receivedAt)}` : `made ${when(o.createdAt)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Body>
        {o.note ? <Body>{o.note}</Body> : null}
        {o.supplierEmail ? <Button label={`Write to ${o.supplierEmail}`} kind="ghost" onPress={() => void Linking.openURL(`mailto:${o.supplierEmail}?subject=${encodeURIComponent(`Restock order #${o.number}`)}`)} /> : null}
      </Card>

      <Section title="Options">
        {o.lines.map((l) => (
          <Card key={l.id}>
            <View role="group" aria-label={l.title} style={{ gap: space(1) }}>
              <Body>{l.title}</Body>
              <Body muted>{`${l.received} of ${l.quantity} in${l.unitCostMinor !== null ? ` · ${money(l.unitCostMinor, cur)} each` : ""}`}</Body>
              {counting && l.received < l.quantity ? (
                <Field label={`Arrived of ${l.title}`} value={counts[l.id] ?? ""} onChangeText={(v) => setCounts({ ...counts, [l.id]: v.replace(/\D/g, "") })} keyboardType="number-pad" placeholder={`Up to ${l.quantity - l.received}`} />
              ) : null}
            </View>
          </Card>
        ))}
      </Section>

      {o.status === "open" ? (
        counting ? (
          <>
            <Button
              label="Add what arrived to stock"
              busy={busy === "count"}
              disabled={!!busy || !Object.values(counts).some((v) => Number(v) > 0)}
              onPress={() => run("count", `restock/${o.id}/receive`, { lines: waiting.map((l) => ({ lineId: l.id, quantity: Number(counts[l.id] || 0) })) })}
            />
            <Button label="Cancel" kind="ghost" onPress={() => setCounting(false)} />
          </>
        ) : confirm ? (
          <>
            <Body>Nothing more is expected. Anything that already arrived stays in your stock.</Body>
            <Button label={`Cancel restock order #${o.number}`} kind="danger" busy={busy === "cancel"} onPress={() => run("cancel", `restock/${o.id}/cancel`, {})} />
            <Button label="Keep it" kind="ghost" onPress={() => setConfirm(false)} />
          </>
        ) : (
          <View style={{ gap: space(2) }}>
            <Button label="Everything arrived" busy={busy === "all"} disabled={!!busy} onPress={() => run("all", `restock/${o.id}/receive`, {})} />
            <Button label="Some of it arrived…" kind="secondary" disabled={!!busy} onPress={() => setCounting(true)} />
            <Button label="Cancel the order…" kind="ghost" disabled={!!busy} onPress={() => setConfirm(true)} />
          </View>
        )
      ) : null}
    </Screen>
  );
}
