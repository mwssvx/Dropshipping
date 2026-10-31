import { useState } from "react";
import { api, useApi } from "../src/api";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen, Section, Toggle } from "../src/ui";

type Data = { wrap: { priceMinor: number; note: string | null } | null; noteMax: number };

/**
 * Gift wrapping at checkout. Buyers who tick "This order is a gift" can add it for the price set
 * here; it's never ticked for them, and the packing slip says to wrap it.
 */
export default function GiftWrapScreen() {
  const data = useApi<Data>("gift-wrap");
  const cur = useSession().me?.shop.currency ?? "USD";
  const [edit, setEdit] = useState<{ on: boolean; price: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const s = edit ?? (d ? { on: !!d.wrap, price: ((d.wrap?.priceMinor ?? 400) / 100).toFixed(2), note: d.wrap?.note ?? "" } : null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("gift-wrap", { method: "PUT", body: s });
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
    <Screen title="Gift wrapping" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !s ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Buyers who say their order is a gift can have it wrapped at checkout. What they pay for it is yours, and the packing slip says to wrap it.</Body>
          <Section title="Wrapping">
            <Card>
              <Toggle label="Offer gift wrapping" value={s.on} onChange={(v) => setEdit({ ...s, on: v })} />
              {s.on ? (
                <>
                  <Field label={`Wrapping price (${cur})`} value={s.price} onChangeText={(v) => setEdit({ ...s, price: v })} keyboardType="decimal-pad" hint="0.00 to wrap for free." />
                  <Field label="What they get (optional)" value={s.note} onChangeText={(v) => setEdit({ ...s, note: v })} placeholder="Kraft paper and a ribbon" hint={`Up to ${d.noteMax} characters.`} />
                </>
              ) : null}
              <Button label="Save gift wrapping" busy={busy} disabled={busy || !edit} onPress={save} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
