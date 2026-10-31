import { useState } from "react";
import { Share, View } from "react-native";
import { api, useApi } from "../src/api";
import { money, when } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, List, LoadError, Loading, Pill, Row, Screen, Section, Segmented } from "../src/ui";
import { space } from "../src/theme";

type Kind = "percent" | "amount" | "free_shipping";
type Batch = { id: string; name: string; prefix: string; count: number; used: number; active: boolean; offer: string; minSubtotalMinor: number; endsAt: string | null };
type Codes = { codes: { code: string; used: boolean; order: string | null }[]; csv: string };
const EMPTY = { name: "", prefix: "", count: "50", kind: "percent" as Kind, value: "10", minSubtotal: "", endsAt: "" };

/**
 * A batch of codes that each work once: printed on cards in your own parcels, given out at a
 * market stall, or one per creator in an influencer box. Nobody can share one code with everyone.
 */
export default function CodeBatchesScreen() {
  const data = useApi<{ max: number; batches: Batch[] }>("code-batches");
  const cur = useSession().me?.shop.currency ?? "USD";
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState<{ id: string; codes: Codes } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const set = (k: keyof typeof EMPTY) => (v: string) => setForm({ ...form, [k]: v });

  async function run(key: string, fn: () => Promise<string | null>) {
    setBusy(key);
    setNote(null);
    try {
      const text = await fn();
      if (text) setNote({ tone: "success", text });
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="One-time codes" back={<BackLink href="/codes" label="Discount codes" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Each code works once, so a code on a parcel card can't end up on a coupon site. They all start the same way, like THANKS-7KQ2M9XA.</Body>
          <Section title="Batches">
            {d.batches.length === 0 ? <EmptyState heading="No batches yet" body="Make a batch below, then share the codes or print them." /> : null}
            {d.batches.map((b) => (
              <Card key={b.id}>
                <View role="group" aria-label={b.name} style={{ gap: space(1) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                    <Heading>{b.name}</Heading>
                    <Pill label={b.active ? "On" : "Off"} tone={b.active ? "success" : "neutral"} />
                  </View>
                  <Body>{`${b.offer}${b.minSubtotalMinor ? ` over ${money(b.minSubtotalMinor, cur)}` : ""} · ${b.prefix}-…`}</Body>
                  <Body muted>{`${b.used} of ${b.count} used${b.endsAt ? ` · ends ${when(b.endsAt)}` : ""}`}</Body>
                  <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                    {open?.id === b.id ? (
                      <Button label="Hide the codes" kind="secondary" a11y={`Hide the ${b.name} codes`} onPress={() => setOpen(null)} />
                    ) : (
                      <Button
                        label="See the codes"
                        kind="secondary"
                        a11y={`See the ${b.name} codes`}
                        busy={busy === `see:${b.id}`}
                        disabled={!!busy}
                        onPress={() => run(`see:${b.id}`, async () => (setOpen({ id: b.id, codes: await api<Codes>(`code-batches/${b.id}/codes`) }), null))}
                      />
                    )}
                    <Button
                      label={b.active ? "Turn off" : "Turn on"}
                      kind="ghost"
                      a11y={`${b.active ? "Turn off" : "Turn on"} ${b.name}`}
                      busy={busy === `on:${b.id}`}
                      disabled={!!busy}
                      onPress={() => run(`on:${b.id}`, async () => (await api<{ message: string }>(`code-batches/${b.id}`, { body: { active: !b.active } })).message)}
                    />
                  </View>
                  {open?.id === b.id ? (
                    <>
                      <Button label="Share all the codes" onPress={() => void Share.share({ message: open.codes.csv, title: `${b.name} codes` })} />
                      <List>
                        {open.codes.codes.slice(0, 100).map((c) => (
                          <Row key={c.code} title={c.code} right={c.used ? <Pill label={c.order ? `Used on ${c.order}` : "Used"} /> : <Pill label="Not used" tone="success" />} />
                        ))}
                      </List>
                      {open.codes.codes.length > 100 ? <Body muted>{`The first 100 of ${open.codes.codes.length}. Share them all to see the rest.`}</Body> : null}
                    </>
                  ) : null}
                </View>
              </Card>
            ))}
          </Section>
          <Section title="New batch">
            <Card>
              <Field label="Name" value={form.name} onChangeText={set("name")} placeholder="Parcel cards" />
              <Field label="Codes start with" value={form.prefix} onChangeText={(v) => set("prefix")(v.toUpperCase())} autoCapitalize="none" placeholder="THANKS" hint="2 to 12 letters or numbers." />
              <Field label="How many codes" value={form.count} onChangeText={set("count")} keyboardType="number-pad" hint={`Up to ${d.max.toLocaleString("en-US")}.`} />
              <Segmented label="Each code gives" value={form.kind} onChange={(k) => setForm({ ...form, kind: k })} options={[["percent", "% off"], ["amount", "Amount off"], ["free_shipping", "Free shipping"]]} />
              {form.kind !== "free_shipping" ? (
                <Field label={form.kind === "percent" ? "Percent off" : "Amount off"} value={form.value} onChangeText={set("value")} keyboardType="decimal-pad" />
              ) : null}
              <Field label="Smallest order (optional)" value={form.minSubtotal} onChangeText={set("minSubtotal")} keyboardType="decimal-pad" placeholder={money(3000, cur)} />
              <Field label="Last day (optional)" value={form.endsAt} onChangeText={set("endsAt")} keyboardType="numbers-and-punctuation" autoCapitalize="none" placeholder="2026-12-31" hint="As YYYY-MM-DD." />
              <Button
                label="Make the codes"
                busy={busy === "make"}
                disabled={!!busy || !form.name.trim() || !form.prefix.trim()}
                onPress={() => run("make", async () => {
                  const r = await api<{ message: string }>("code-batches", { body: form });
                  setForm(EMPTY);
                  return r.message;
                })}
              />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
