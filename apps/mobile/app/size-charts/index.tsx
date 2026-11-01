import { useRouter } from "expo-router";
import { useState } from "react";
import { api, useApi } from "../../src/api";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, List, LoadError, Loading, Pill, Row, Screen, Section } from "../../src/ui";

type Chart = { id: string; name: string; sizes: number; products: number; collections: number; published: boolean };

// A new chart starts like the web's: a few sizes and the usual measurements, filled in on the next screen.
const BLANK = {
  unit: "cm",
  columns: ["Size", "Chest", "Waist", "Length"],
  rows: ["S", "M", "L"].map((s) => [s, "", "", ""]),
  note: "Measured flat, garment laid out.",
  published: true,
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Size charts: one table of measurements, shown on every product it's attached to, directly or through a collection. */
export default function SizeChartsScreen() {
  const router = useRouter();
  const data = useApi<{ max: number; charts: Chart[] }>("size-charts");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const d = data.data;

  async function start() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ id: string }>("size-charts", { body: { ...BLANK, name } });
      setName("");
      router.push(`/size-charts/${r.id}`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Size charts" back={<BackLink href="/products" label="Products" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone="critical">{note}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Make a size table once and attach it to products or whole collections. Buyers open it from the product page and can switch between centimetres and inches. Clear sizes mean fewer returns.</Body>
          <Section title={`Your size charts (${d.charts.length} of ${d.max})`}>
            {d.charts.length === 0 ? (
              <EmptyState heading="No size charts yet" body="Start one below, then fill in the measurements." />
            ) : (
              <List>
                {d.charts.map((c) => {
                  const attached = c.products + c.collections;
                  const state = !c.published ? "Hidden" : attached ? "On the store" : "Not attached";
                  return (
                    <Row
                      key={c.id}
                      href={`/size-charts/${c.id}`}
                      title={c.name}
                      subtitle={[count(c.sizes, "size", "sizes"), count(c.products, "product", "products"), c.collections ? count(c.collections, "collection", "collections") : null].filter(Boolean).join(" · ")}
                      right={<Pill label={state} tone={state === "On the store" ? "success" : "neutral"} />}
                      a11y={`${c.name}, ${state.toLowerCase()}`}
                    />
                  );
                })}
              </List>
            )}
          </Section>
          <Section title="New size chart">
            <Card>
              <Field label="Name" value={name} onChangeText={setName} placeholder="T-shirts" />
              <Button label="Start size chart" busy={busy} disabled={busy || !name.trim()} onPress={start} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
