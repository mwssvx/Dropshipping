import { useState } from "react";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, List, LoadError, Loading, Row, Screen, Section, Toggle } from "../src/ui";

type Cutoff = { hour: number; timeZone: string; weekends: boolean };
type Data = { on: boolean; processingDays: number; cutoff: Cutoff | null; zones: { id: string; name: string }[]; defaultZone: string };

const hourLabel = (h: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 1, h)));

/**
 * Delivery dates: product pages, the cart, checkout and receipts say when an order should arrive,
 * counted from the days it takes to get ready plus the shipping time. Buyers ordering gifts want to know.
 */
export default function DeliveryDatesScreen() {
  const data = useApi<Data>("delivery-dates");
  const [edit, setEdit] = useState<{ on: boolean; processingDays: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const s = edit ?? (d ? { on: d.on, processingDays: String(d.processingDays) } : null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("delivery-dates", { method: "PUT", body: s });
      setNote({ tone: "success", text: r.message });
      setEdit(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Delivery dates" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !s ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Product pages say "Arrives Nov 4 – Nov 7", and so do the cart, checkout and the receipt. Products with their own time to get ready count that instead.</Body>
          <Section title="Dates">
            <Card>
              <Toggle label="Show delivery dates" value={s.on} onChange={(v) => setEdit({ ...s, on: v })} />
              <Field
                label="Days to get an order ready"
                value={s.processingDays}
                onChangeText={(v) => setEdit({ ...s, processingDays: v })}
                keyboardType="number-pad"
                hint="Before it leaves you or your supplier: 0 to 14 days."
              />
              <Button label="Save delivery dates" busy={busy} disabled={busy || !edit} onPress={save} />
            </Card>
          </Section>
          <CutoffSection data={d} reload={data.reload} />
        </>
      )}
    </Screen>
  );
}

/** The same-day cutoff: orders in by a set time ship that day, and product pages count down to it. */
function CutoffSection({ data: d, reload }: { data: Data; reload: () => Promise<void> }) {
  const saved = { on: d.cutoff !== null, hour: d.cutoff?.hour ?? 14, timeZone: d.cutoff?.timeZone ?? d.defaultZone, weekends: d.cutoff?.weekends ?? false };
  const [edit, setEdit] = useState<typeof saved | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const c = edit ?? saved;
  const zone = d.zones.find((z) => z.id === c.timeZone)?.name ?? c.timeZone;
  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("delivery-dates/cutoff", { method: "PUT", body: c });
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
    <Section title="Same-day cutoff">
      <Card>
        {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
        <Body muted>If you pack orders yourself, or your supplier ships the same day, say what time orders must be in by. Product pages count down to it ("Order within 2 h 14 min and it ships today"), and later orders start the next shipping day.</Body>
        <Toggle label="Orders in by a set time ship that day" value={c.on} onChange={(v) => setEdit({ ...c, on: v })} />
        {c.on ? (
          <>
            <Body>{`Order by ${hourLabel(c.hour)}`}</Body>
            <Button label="Earlier" kind="secondary" a11y="Make the cutoff an hour earlier" disabled={c.hour <= 1} onPress={() => setEdit({ ...c, hour: c.hour - 1 })} />
            <Button label="Later" kind="secondary" a11y="Make the cutoff an hour later" disabled={c.hour >= 23} onPress={() => setEdit({ ...c, hour: c.hour + 1 })} />
            <List>
              <Row title="Your time zone" subtitle={zone} onPress={() => setPicking(!picking)} a11y={`Your time zone: ${zone}. Change it`} />
              {picking
                ? d.zones.map((z) => (
                    <Row
                      key={z.id}
                      title={z.name}
                      onPress={() => {
                        setEdit({ ...c, timeZone: z.id });
                        setPicking(false);
                      }}
                      a11y={`Use ${z.name}`}
                    />
                  ))
                : null}
            </List>
            <Toggle label="We ship at weekends" value={c.weekends} onChange={(v) => setEdit({ ...c, weekends: v })} />
          </>
        ) : null}
        <Button label="Save cutoff" busy={busy} disabled={busy || !edit} onPress={save} />
      </Card>
    </Section>
  );
}
