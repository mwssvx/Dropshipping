import { useState } from "react";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, List, LoadError, Loading, Row, Screen, Section, Toggle } from "../src/ui";

type Data = {
  currency: string;
  name: string;
  round: boolean;
  asOf: string;
  sample: { title: string; price: string };
  options: { code: string; name: string; on: boolean; rate: string; sample: string }[];
};

/** The currencies buyers can see prices, pay and get refunds in, converted at the day's rate. */
export default function CurrenciesScreen() {
  const data = useApi<Data>("currencies");
  const [edit, setEdit] = useState<{ on: string[]; round: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const f = edit ?? (d ? { on: d.options.filter((o) => o.on).map((o) => o.code), round: d.round } : null);

  async function save() {
    if (!f) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("currencies", { method: "PUT", body: { currencies: f.on, round: f.round } });
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
    <Screen title="Currencies" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !f ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>{`Your prices are in ${d.name} (${d.currency}). Turn on other currencies and buyers see prices, pay and get refunds in their own, converted at the European Central Bank's daily rate. They get their own currency when they shop from that country, and can switch at the top of the store.`}</Body>
          <Section title="Currencies buyers can use">
            <Card>
              <Body muted>{`${d.currency} is always on: it's your store's currency.`}</Body>
              {d.options.map((o) => (
                <Toggle
                  key={o.code}
                  label={`${o.code} · ${o.name}`}
                  value={f.on.includes(o.code)}
                  onChange={(v) => setEdit({ ...f, on: v ? [...f.on, o.code] : f.on.filter((c) => c !== o.code) })}
                />
              ))}
              <Toggle label="Round converted prices to end in .99" value={f.round} onChange={(v) => setEdit({ ...f, round: v })} />
              <Body muted>£18.42 shows as £18.99. Buyers pay exactly what they see.</Body>
              <Button label="Save currencies" busy={busy} disabled={busy || !edit} onPress={save} />
            </Card>
          </Section>
          <Section title="Today's rates">
            <List>
              {d.options.map((o) => (
                <Row key={o.code} title={o.code} subtitle={`1 ${d.currency} is ${o.rate} · ${d.sample.title} at ${d.sample.price} is ${o.sample}`} />
              ))}
            </List>
            <Body muted>{`Rates as of ${d.asOf}. Each order keeps the rate it was placed at. We don't add anything to the rate; Stripe converts the payment into ${d.currency} for your payouts and charges its own conversion fee.`}</Body>
          </Section>
        </>
      )}
    </Screen>
  );
}
