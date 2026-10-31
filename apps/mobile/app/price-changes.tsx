import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../src/api";
import { money, when } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, List, LoadError, Loading, Pill, Row, Screen, Section, Toggle } from "../src/ui";
import { color, space } from "../src/theme";

type Change = {
  id: string;
  title: string;
  status: "open" | "repriced" | "raised" | "kept";
  costBeforeMinor: number;
  costAfterMinor: number;
  priceMinor: number;
  newPriceMinor: number | null;
  suggestedPriceMinor: number | null;
  marginBefore: number;
  marginNow: number;
  belowTarget: boolean;
  createdAt: string;
};
type Data = { minMarginPercent: number; autoReprice: boolean; changes: Change[]; testProducts: { id: string; title: string }[] };

const DONE: Record<Exclude<Change["status"], "open">, string> = { repriced: "Raised automatically", raised: "Price raised", kept: "Price kept" };

/**
 * When a supplier starts charging more: the margin before and after, and one tap to raise the
 * price with the pricing rule or keep it. Also the margin that sends a warning, and automatic raises.
 */
export default function PriceChangesScreen() {
  const data = useApi<Data>("price-changes");
  const cur = useSession().me?.shop.currency ?? "USD";
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const [margin, setMargin] = useState<string | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);

  const d = data.data;
  const open = d?.changes.filter((c) => c.status === "open") ?? [];
  const done = d?.changes.filter((c) => c.status !== "open").slice(0, 20) ?? [];

  async function run(key: string, fn: () => Promise<string | undefined>) {
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

  const resolve = (c: Change, action: "raise" | "keep") =>
    run(`${action}:${c.id}`, async () => (await api<{ message: string }>(`price-changes/${c.id}`, { body: { action } })).message);

  const saveWatch = () =>
    run("watch", async () => {
      const r = await api<{ message: string }>("price-changes/watch", {
        method: "PUT",
        body: { minMarginPercent: margin ?? String(d!.minMarginPercent), autoReprice: auto ?? d!.autoReprice },
      });
      setMargin(null);
      setAuto(null);
      return r.message;
    });

  return (
    <Screen title="Price changes" back={<BackLink href="/products" label="Products" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>We check your suppliers' prices every day. When one charges more, it shows here with your margin before and after.</Body>
          <Section title="Needs a look">
            {open.length === 0 ? (
              <EmptyState heading="Nothing to look at" body="No supplier has raised a price." />
            ) : (
              open.map((c) => (
                <Card key={c.id}>
                  <View role="group" aria-label={c.title} style={{ gap: space(1) }}>
                    <Heading>{c.title}</Heading>
                    <Body muted>{`Cost ${money(c.costBeforeMinor, cur)} → ${money(c.costAfterMinor, cur)} · price ${money(c.priceMinor, cur)} · since ${when(c.createdAt)}`}</Body>
                    <Body style={c.belowTarget ? { color: color.critical } : undefined}>
                      {`Margin ${c.marginBefore}% → ${c.marginNow}%${c.belowTarget ? `, below your ${d.minMarginPercent}%` : ""}`}
                    </Body>
                    <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                      {c.suggestedPriceMinor ? (
                        <Button label={`Raise to ${money(c.suggestedPriceMinor, cur)}`} busy={busy === `raise:${c.id}`} disabled={!!busy} onPress={() => resolve(c, "raise")} />
                      ) : null}
                      <Button label="Keep price" kind="secondary" busy={busy === `keep:${c.id}`} disabled={!!busy} onPress={() => resolve(c, "keep")} a11y={`Keep the price of ${c.title}`} />
                    </View>
                  </View>
                </Card>
              ))
            )}
          </Section>
          <Section title="Price watch">
            <Card>
              <Field
                label="Warn me below this margin (%)"
                value={margin ?? String(d.minMarginPercent)}
                onChangeText={setMargin}
                keyboardType="number-pad"
                hint="We send one email when a rise takes a product below it."
              />
              <Toggle label="Raise prices automatically with my pricing rule" value={auto ?? d.autoReprice} onChange={setAuto} />
              <Body muted>Prices only ever go up this way, and we email you each time. They never go down on their own.</Body>
              <Button label="Save price watch" kind="secondary" busy={busy === "watch"} disabled={!!busy} onPress={saveWatch} />
            </Card>
          </Section>
          {done.length ? (
            <Section title="Dealt with">
              <List>
                {done.map((c) => (
                  <Row
                    key={c.id}
                    title={c.title}
                    subtitle={`Cost ${money(c.costBeforeMinor, cur)} → ${money(c.costAfterMinor, cur)} · price ${money(c.priceMinor, cur)}${c.newPriceMinor ? ` → ${money(c.newPriceMinor, cur)}` : ""}`}
                    right={<Pill label={DONE[c.status as keyof typeof DONE]} tone={c.status === "kept" ? "neutral" : "success"} />}
                  />
                ))}
              </List>
            </Section>
          ) : null}
          {d.testProducts.length ? (
            <Section title="Test mode">
              <Body muted>Make the supplier of a product charge 90% of its price, to see how a rise looks.</Body>
              <List>
                {d.testProducts.slice(0, 5).map((p) => (
                  <Row
                    key={p.id}
                    title={p.title}
                    a11y={`Simulate a supplier price rise for ${p.title}`}
                    onPress={() => run(`sim:${p.id}`, async () => { await api("price-changes/simulate", { body: { productId: p.id } }); return undefined; })}
                  />
                ))}
              </List>
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}
