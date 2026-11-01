import { useState } from "react";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen, Section, Toggle } from "../src/ui";

type Dates = { from: string; to: string; until: string };
type Data = { holiday: Dates | null; windowDays: number; suggested: Dates };

/**
 * Gifts get opened weeks after they're bought, so orders paid in a holiday stretch can come back
 * later than usual. The buyer's order page, the returns policy and product pages say so.
 */
export default function HolidayReturnsScreen() {
  const data = useApi<Data>("holiday-returns");
  const [edit, setEdit] = useState<({ on: boolean } & Dates) | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const s = edit ?? (d ? { on: !!d.holiday, ...(d.holiday ?? d.suggested) } : null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("holiday-returns", { method: "PUT", body: s });
      setNote({ tone: "success", text: r.message });
      setEdit(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const day = { keyboardType: "numbers-and-punctuation" as const, autoCapitalize: "none" as const, placeholder: "YYYY-MM-DD" };
  return (
    <Screen title="Holiday returns" back={<BackLink href="/returns" label="Returns" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !s ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>{`Orders usually have ${d.windowDays} days to come back. Gifts get opened weeks later, so holiday orders can have longer.`}</Body>
          <Section title="Gift returns">
            <Card>
              <Toggle label="Keep returns open longer for holiday orders" value={s.on} onChange={(v) => setEdit({ ...s, on: v })} />
              {s.on ? (
                <>
                  <Field label="Orders paid from" value={s.from} onChangeText={(v) => setEdit({ ...s, from: v })} {...day} />
                  <Field label="To" value={s.to} onChangeText={(v) => setEdit({ ...s, to: v })} {...day} />
                  <Field label="Can be returned until" value={s.until} onChangeText={(v) => setEdit({ ...s, until: v })} {...day} hint="Dates as YYYY-MM-DD." />
                </>
              ) : null}
              <Button label="Save holiday returns" busy={busy} disabled={busy || !edit} onPress={save} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
