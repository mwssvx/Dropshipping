import { useState } from "react";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen, Section, Toggle } from "../src/ui";

type Data = { on: boolean; processingDays: number };

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
        </>
      )}
    </Screen>
  );
}
