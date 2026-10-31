import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, LoadError, Loading, Pill, Screen, Section, Toggle } from "../src/ui";
import { space } from "../src/theme";

type Bundle = { id: string; title: string; percentOff: number; active: boolean; live: boolean; products: { id: string; title: string }[] };
type Data = { bundles: Bundle[]; choices: { id: string; title: string; draft: boolean }[]; max: number; maxPercent: number };
const EMPTY = { title: "", percentOff: "10", productIds: [] as string[] };

/**
 * Products sold together for less. A bundle shows on each of its products' pages with one button
 * to add them all, and buyers get the discount on every full set in their cart.
 */
export default function BundlesScreen() {
  const data = useApi<Data>("bundles");
  const [form, setForm] = useState(EMPTY);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;

  async function run(key: string, path: string, init: { method?: string; body?: unknown }, after?: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, init);
      setNote({ tone: "success", text: r.message });
      after?.();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const pick = (id: string, on: boolean) => setForm({ ...form, productIds: on ? [...form.productIds, id] : form.productIds.filter((x) => x !== id) });

  return (
    <Screen title="Bundles" back={<BackLink href="/products" label="Products" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Sell products together for less. Bundles and discount codes don't combine: the cart uses whichever saves the buyer more.</Body>
          <Section title={`Your bundles (${d.bundles.length} of ${d.max})`}>
            {d.bundles.length === 0 ? <EmptyState heading="No bundles yet" body="A lamp with its bulbs, or a mug with a coaster, sells better as a set." /> : null}
            {d.bundles.map((b) => (
              <Card key={b.id}>
                <View role="group" aria-label={b.title} style={{ gap: space(1) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                    <Heading>{b.title}</Heading>
                    <Pill label={b.live ? "On your store" : b.active ? "Waiting" : "Off"} tone={b.live ? "success" : b.active ? "warning" : "neutral"} />
                  </View>
                  <Body>{`${b.percentOff}% off ${b.products.map((p) => p.title).join(" + ")}`}</Body>
                  {b.active && !b.live ? <Body muted>It shows once all of its products are on sale.</Body> : null}
                  <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                    <Button
                      label={b.active ? "Switch off" : "Switch on"}
                      kind="secondary"
                      a11y={`${b.active ? "Switch off" : "Switch on"} ${b.title}`}
                      busy={busy === `on:${b.id}`}
                      disabled={!!busy}
                      onPress={() => run(`on:${b.id}`, `bundles/${b.id}`, { body: { active: !b.active } })}
                    />
                    {confirm === b.id ? (
                      <Button label={`Delete ${b.title}`} kind="danger" busy={busy === `del:${b.id}`} disabled={!!busy} onPress={() => run(`del:${b.id}`, `bundles/${b.id}`, { method: "DELETE" }, () => setConfirm(null))} />
                    ) : (
                      <Button label="Delete…" kind="ghost" a11y={`Delete ${b.title}…`} disabled={!!busy} onPress={() => setConfirm(b.id)} />
                    )}
                  </View>
                </View>
              </Card>
            ))}
          </Section>
          <Section title="New bundle">
            {d.choices.length < 2 ? (
              <EmptyState heading="Add products first" body="A bundle needs at least two of your products." />
            ) : (
              <Card>
                <Field label="Name" value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} placeholder="Lamp and bulbs" />
                <Field label="Discount (%)" value={form.percentOff} onChangeText={(v) => setForm({ ...form, percentOff: v })} keyboardType="number-pad" hint={`1% to ${d.maxPercent}% off the full set.`} />
                <Body muted>{`Pick 2 to 4 products (${form.productIds.length} picked).`}</Body>
                <View role="group" aria-label="Products in the bundle" style={{ gap: space(1) }}>
                  {d.choices.map((p) => (
                    <Toggle
                      key={p.id}
                      label={p.draft ? `${p.title} (draft)` : p.title}
                      value={form.productIds.includes(p.id)}
                      onChange={(v) => pick(p.id, v)}
                    />
                  ))}
                </View>
                <Button
                  label="Add bundle"
                  busy={busy === "add"}
                  disabled={!!busy || !form.title.trim() || form.productIds.length < 2}
                  onPress={() => run("add", "bundles", { body: form }, () => setForm(EMPTY))}
                />
              </Card>
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}
