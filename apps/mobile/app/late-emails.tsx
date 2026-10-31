import { useState } from "react";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen, Section, Segmented, Toggle } from "../src/ui";

type Data = { notice: { days: number; message: string | null; transit?: boolean } | null; days: number[]; messageMax: number };

/**
 * A buyer whose order still hasn't shipped after some days gets one email saying it hasn't been
 * forgotten. Buyers who hear first rarely ask where it is, or open a dispute.
 */
export default function LateEmailsScreen() {
  const data = useApi<Data>("late-emails");
  const [edit, setEdit] = useState<{ on: boolean; days: string; message: string; transit: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const s = edit ?? (d ? { on: !!d.notice, days: String(d.notice?.days ?? 5), message: d.notice?.message ?? "", transit: !!d.notice?.transit } : null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("late-emails", { method: "PUT", body: { ...s, days: Number(s!.days) } });
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
    <Screen title="Running late emails" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !s ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Each buyer hears once. Orders on hold, pre-orders, pickups and local deliveries, and orders already on their way are left alone.</Body>
          <Section title="Email">
            <Card>
              <Toggle label="Email buyers when an order is running late" value={s.on} onChange={(v) => setEdit({ ...s, on: v })} />
              {s.on ? (
                <>
                  <Segmented label="When it hasn't shipped after" value={s.days} onChange={(v) => setEdit({ ...s, days: v })} options={d.days.map((n) => [String(n), `${n} days`] as [string, string])} />
                  <Field label="Your own words (optional)" value={s.message} onChangeText={(v) => setEdit({ ...s, message: v })} multiline placeholder="Our handmade pieces take a little longer this month." hint={`Up to ${d.messageMax} characters.`} />
                  <Toggle label="Also email when a shipped parcel is past its delivery date" value={s.transit} onChange={(v) => setEdit({ ...s, transit: v })} />
                </>
              ) : null}
              <Button label="Save running late emails" busy={busy} disabled={busy || !edit} onPress={save} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
