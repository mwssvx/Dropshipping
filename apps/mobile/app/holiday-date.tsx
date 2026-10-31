import { useState } from "react";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen, Section, Toggle } from "../src/ui";

type Data = { deadline: { name: string; arriveBy: string } | null; nameMax: number };

/**
 * Name a holiday and the day orders must arrive by. Product pages and the cart say the last day to
 * order, counted from the slowest delivery date, and warn it may arrive late after that.
 */
export default function HolidayDateScreen() {
  const data = useApi<Data>("holiday-date");
  const [edit, setEdit] = useState<{ on: boolean; name: string; arriveBy: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const s = edit ?? (d ? { on: !!d.deadline, name: d.deadline?.name ?? "Christmas", arriveBy: d.deadline?.arriveBy ?? "" } : null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("holiday-date", { method: "PUT", body: s });
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
    <Screen title="Holiday order-by date" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !s ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Product pages and the cart say “Order by Dec 15 to get it in time for Christmas”, counted from the slowest delivery date. After that day they warn it may arrive late, and once the holiday has passed the line goes away by itself.</Body>
          <Section title="Holiday">
            <Card>
              <Toggle label="Show an order-by date for a holiday" value={s.on} onChange={(v) => setEdit({ ...s, on: v })} />
              {s.on ? (
                <>
                  <Field label="Holiday" value={s.name} onChangeText={(v) => setEdit({ ...s, name: v })} placeholder="Christmas" hint={`Up to ${d.nameMax} characters.`} />
                  <Field label="Must arrive by" value={s.arriveBy} onChangeText={(v) => setEdit({ ...s, arriveBy: v })} placeholder="2026-12-24" keyboardType="numbers-and-punctuation" autoCapitalize="none" hint="As YYYY-MM-DD." />
                </>
              ) : null}
              <Button label="Save holiday date" busy={busy} disabled={busy || !edit} onPress={save} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
