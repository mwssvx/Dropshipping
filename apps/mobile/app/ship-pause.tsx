import { useState } from "react";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Pill, Screen, Section, Toggle } from "../src/ui";

type Data = { pause: { from: string | null; resumesOn: string; message: string | null } | null; active: boolean; maxDays: number; messageMax: number };
const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const fmt = (d: string) => day.format(new Date(`${d}T12:00:00Z`));

/**
 * When the supplier closes for a while (Chinese New Year, a move, a holiday), keep selling: every
 * page says when orders ship again, and delivery dates move to match.
 */
export default function ShipPauseScreen() {
  const data = useApi<Data>("ship-pause");
  const [edit, setEdit] = useState<{ on: boolean; from: string; resumesOn: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const s = edit ?? (d ? { on: !!d.pause, from: d.pause?.from ?? "", resumesOn: d.pause?.resumesOn ?? "", message: d.pause?.message ?? "" } : null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("ship-pause", { method: "PUT", body: s });
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
    <Screen title="Shipping pause" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !s ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Orders still come in while shipping is paused. Every page says when they ship again, delivery dates move to match, and in the week before it starts shoppers see the last day to order.</Body>
          {d.pause ? (
            <Pill
              label={d.active ? `Paused until ${fmt(d.pause.resumesOn)}` : `Pauses ${fmt(d.pause.from ?? d.pause.resumesOn)} to ${fmt(d.pause.resumesOn)}`}
              tone={d.active ? "warning" : "info"}
            />
          ) : null}
          <Section title="Pause">
            <Card>
              <Toggle label="Pause shipping" value={s.on} onChange={(v) => setEdit({ ...s, on: v })} />
              {s.on ? (
                <>
                  <Field label="Starts on (optional)" value={s.from} onChangeText={(v) => setEdit({ ...s, from: v })} placeholder="Today" keyboardType="numbers-and-punctuation" autoCapitalize="none" hint="As YYYY-MM-DD. Leave empty to start today." />
                  <Field label="Ships again on" value={s.resumesOn} onChangeText={(v) => setEdit({ ...s, resumesOn: v })} placeholder="2027-02-20" keyboardType="numbers-and-punctuation" autoCapitalize="none" hint={`As YYYY-MM-DD, up to ${d.maxDays} days away.`} />
                  <Field label="Message for buyers (optional)" value={s.message} onChangeText={(v) => setEdit({ ...s, message: v })} multiline placeholder="Our supplier is closed for Chinese New Year." hint={`Up to ${d.messageMax} characters.`} />
                </>
              ) : null}
              <Button label="Save shipping pause" busy={busy} disabled={busy || !edit} onPress={save} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
