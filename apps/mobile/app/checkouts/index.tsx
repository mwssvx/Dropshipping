import { useState } from "react";
import { Linking, View } from "react-native";
import { api, useApi } from "../../src/api";
import { money, when } from "../../src/format";
import { useCan, useSession } from "../../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, List, LoadError, Loading, Pill, Row, Screen, Section, Stat, Toggle } from "../../src/ui";

type Checkout = { id: string; number: number; name: string | null; email: string; totalMinor: number; currency: string; items: number; createdAt: string; reminder: "none" | "sent" | "code"; paidAs: number | null };
type Data = { days: number; remindersOn: boolean; offerPercent: number | null; totals: { count: number; valueMinor: number; recovered: number }; checkouts: Checkout[] };

/** Buyers who got to checkout and didn't pay: what they left, whether they were reminded, and who came back. */
export default function CheckoutsScreen() {
  const cur = useSession().me?.shop.currency ?? "USD";
  const can = useCan();
  const data = useApi<Data>("checkouts");
  const d = data.data;
  return (
    <Screen title="Left at checkout" back={<BackLink href="/orders" label="Orders" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          {!d.remindersOn ? (
            <Banner tone="warning">{can("marketing") ? "Reminder emails are off, so nobody is reminded. Turn them on below." : "Reminder emails are off, so nobody is reminded."}</Banner>
          ) : null}
          {d.totals.count ? (
            <View style={{ flexDirection: "row", gap: 1 }}>
              <Stat label="Left unpaid" value={String(d.totals.count)} />
              <Stat label="Worth" value={money(d.totals.valueMinor, cur)} />
              <Stat label="Came back" value={String(d.totals.recovered)} />
            </View>
          ) : null}
          {d.checkouts.length === 0 ? (
            <EmptyState heading="Nobody left at checkout" body={`When a buyer leaves at checkout in the last ${d.days} days, it shows up here an hour later.`} />
          ) : (
            <List>
              {d.checkouts.map((c) => (
                <Row
                  key={c.id}
                  a11y={`Checkout by ${c.name || c.email}`}
                  title={c.name || c.email}
                  subtitle={[
                    `${money(c.totalMinor, c.currency)} · ${c.items} ${c.items === 1 ? "item" : "items"} · ${when(c.createdAt)}`,
                    c.reminder === "code" ? "Reminded, with a code" : c.reminder === "sent" ? "Reminded" : "Not reminded yet",
                  ].join("\n")}
                  right={c.paidAs === null ? <Pill label="Not yet" /> : <Pill label={c.paidAs === c.number ? "Paid" : `Paid as #${c.paidAs}`} tone="success" />}
                  onPress={() => void Linking.openURL(`mailto:${c.email}`)}
                />
              ))}
            </List>
          )}
        </>
      )}
      {d && can("marketing") ? <RemindersSection data={d} reload={data.reload} /> : null}
    </Screen>
  );
}

/** Reminder emails: one an hour after a buyer leaves, and optionally a second a day later with a one-time code. */
function RemindersSection({ data: d, reload }: { data: Data; reload: () => Promise<void> }) {
  const saved = { on: d.remindersOn, offer: d.offerPercent !== null, percentOff: String(d.offerPercent ?? 10) };
  const [edit, setEdit] = useState<typeof saved | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const s = edit ?? saved;
  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("checkouts/reminders", { method: "PUT", body: s });
      setNote({ tone: "success", text: r.message });
      setEdit(null);
      await reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Reminder emails">
      <Card>
        {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
        <Toggle label="Remind buyers who leave at checkout" value={s.on} onChange={(v) => setEdit({ ...s, on: v })} />
        {s.on ? (
          <>
            <Body muted>The first reminder goes an hour after they leave, with what was in their cart.</Body>
            <Toggle label="Send a second reminder with a code" value={s.offer} onChange={(v) => setEdit({ ...s, offer: v })} />
            {s.offer ? (
              <Field
                label="Percent off (%)"
                value={s.percentOff}
                onChangeText={(v) => setEdit({ ...s, percentOff: v })}
                keyboardType="number-pad"
                hint="5% to 50%. A day after the first, in a code that works once, for that buyer only, for 48 hours."
              />
            ) : null}
          </>
        ) : null}
        <Button label="Save reminder emails" busy={busy} disabled={busy || !edit} onPress={save} />
      </Card>
    </Section>
  );
}
