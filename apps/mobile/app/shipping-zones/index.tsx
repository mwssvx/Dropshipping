import { useState } from "react";
import { api, useApi } from "../../src/api";
import { BackLink, Banner, Body, Button, Card, Field, List, LoadError, Loading, Row, Screen, Section } from "../../src/ui";

export type Zones = {
  currency: string;
  isDefault: boolean;
  standard: string | null;
  home: string;
  noWeight: number;
  countries: { code: string; name: string }[];
  zones: { id: string; name: string; countries: string[]; rates: { id: string; name: string; price: string; freeOver: string | null; days: string | null; weight: string | null }[] }[];
};

const BLANK = { name: "", price: "", freeOver: "", minDays: "", maxDays: "", minKg: "", maxKg: "" };

/** Shipping zones and their rates: what buyers in each group of countries pay, and how long it takes. */
export default function ShippingZonesScreen() {
  const data = useApi<Zones>("shipping/zones");
  const [adding, setAdding] = useState<string | null>(null);
  const [rate, setRate] = useState(BLANK);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const name = (code: string) => d?.countries.find((c) => c.code === code)?.name ?? code;

  async function run(key: string, path: string, method: "POST" | "DELETE", body?: unknown, after?: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { method, body });
      setNote({ tone: "success", text: r.message });
      after?.();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Shipping rates" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : d.isDefault ? (
        <Section title="You use the standard rate">
          <Card>
            <Body>{`${d.standard}, to every country. Set up zones to charge by country and add a faster option. You get two to start from: ${d.home} (Standard and Express) and International.`}</Body>
            <Button label="Set up shipping zones" busy={busy === "starter"} disabled={!!busy} onPress={() => void run("starter", "shipping/zones/starter", "POST")} />
          </Card>
        </Section>
      ) : (
        <>
          <Body muted>Buyers pick a rate at checkout. Countries in no zone can't check out, and gift cards never pay shipping.</Body>
          {d.noWeight > 0 ? (
            <Banner tone="warning">{`${d.noWeight === 1 ? "1 product has" : `${d.noWeight} products have`} an option with no weight. Your rates by weight count those as weighing nothing, so a heavy order could ship for the lightest rate.`}</Banner>
          ) : null}
          {d.zones.map((z) => (
            <Section key={z.id} title={z.name}>
              <List>
                <Row href={`/shipping-zones/${z.id}`} title="Name and countries" subtitle={z.countries.map(name).join(", ")} a11y={`Edit the ${z.name} zone`} />
              </List>
              {z.rates.length === 0 ? <Banner tone="warning">No rates yet, so buyers in these countries can't check out.</Banner> : null}
              {z.rates.map((r) => (
                <Card key={r.id}>
                  <Body>{`${r.name} · ${r.price}${r.freeOver ? ` · free over ${r.freeOver}` : ""}`}</Body>
                  {r.days || r.weight ? <Body muted>{[r.days, r.weight ? `orders ${r.weight}` : null].filter(Boolean).join(" · ")}</Body> : null}
                  <Button label="Remove" kind="ghost" a11y={`Remove ${r.name} from ${z.name}`} busy={busy === r.id} disabled={!!busy} onPress={() => void run(r.id, `shipping/rates/${r.id}`, "DELETE")} />
                </Card>
              ))}
              {adding === z.id ? (
                <Card>
                  <Field label="Rate name" value={rate.name} onChangeText={(v) => setRate({ ...rate, name: v })} placeholder="Standard" />
                  <Field label={`Price (${d.currency})`} value={rate.price} onChangeText={(v) => setRate({ ...rate, price: v })} keyboardType="decimal-pad" placeholder="0 for free" />
                  <Field label="Free over (optional)" value={rate.freeOver} onChangeText={(v) => setRate({ ...rate, freeOver: v })} keyboardType="decimal-pad" />
                  <Field label="Days from" value={rate.minDays} onChangeText={(v) => setRate({ ...rate, minDays: v })} keyboardType="number-pad" />
                  <Field label="Days to" value={rate.maxDays} onChangeText={(v) => setRate({ ...rate, maxDays: v })} keyboardType="number-pad" />
                  <Field label="Orders from (kg, optional)" value={rate.minKg} onChangeText={(v) => setRate({ ...rate, minKg: v })} keyboardType="decimal-pad" hint="Charge more for heavy orders with one rate per weight range." />
                  <Field label="Up to (kg, optional)" value={rate.maxKg} onChangeText={(v) => setRate({ ...rate, maxKg: v })} keyboardType="decimal-pad" />
                  <Button
                    label="Add rate"
                    busy={busy === `add-${z.id}`}
                    disabled={!!busy || !rate.name.trim()}
                    onPress={() =>
                      void run(`add-${z.id}`, `shipping/zones/${z.id}/rates`, "POST", rate, () => {
                        setAdding(null);
                        setRate(BLANK);
                      })
                    }
                  />
                  <Button label="Cancel" kind="ghost" onPress={() => setAdding(null)} />
                </Card>
              ) : (
                <Button
                  label="Add a rate"
                  kind="secondary"
                  a11y={`Add a rate to ${z.name}`}
                  disabled={!!busy}
                  onPress={() => {
                    setAdding(z.id);
                    setRate(BLANK);
                  }}
                />
              )}
            </Section>
          ))}
          <List>
            <Row href="/shipping-zones/new" title="Add a zone" subtitle="A group of countries with its own rates" />
          </List>
        </>
      )}
    </Screen>
  );
}
