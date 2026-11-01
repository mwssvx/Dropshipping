import { useState } from "react";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, Field, List, LoadError, Loading, Row, Screen, Section, Segmented, Toggle } from "../src/ui";

type Ending = "99" | "95" | "00" | "none";
type Rule = { kind: "multiplier" | "fixed"; value: number; ending: Ending; compareAtPercent: number | null; minPriceMinor: number };
type Data = {
  rule: Rule;
  examples: { costMinor: number; priceMinor: number; compareAtMinor: number | null; keepMinor: number }[];
  repricing: { products: number; options: number; noCost: number; rows: { variantId: string; productId: string; title: string; costMinor: number; priceMinor: number; newPriceMinor: number; newCompareAtMinor: number | null }[] };
};
type Form = { kind: "multiplier" | "fixed"; multiplier: string; fixed: string; ending: Ending; compareAt: boolean; compareAtPercent: string; minPrice: string };

const formOf = (r: Rule): Form => ({
  kind: r.kind,
  multiplier: r.kind === "multiplier" ? String(r.value) : "2.5",
  fixed: r.kind === "fixed" ? (r.value / 100).toFixed(2) : "10.00",
  ending: r.ending,
  compareAt: !!r.compareAtPercent,
  compareAtPercent: String(r.compareAtPercent ?? 30),
  minPrice: (r.minPriceMinor / 100).toFixed(2),
});

/**
 * The pricing rule: how an imported product's starting price comes from the supplier's cost, with
 * what you'd keep after fees. Products whose prices don't follow it can be brought in line at once.
 */
export default function PricingScreen() {
  const cur = useSession().me?.shop.currency ?? "USD";
  const data = useApi<Data>("pricing");
  const [edit, setEdit] = useState<Form | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const f = edit ?? (d ? formOf(d.rule) : null);
  const m = (x: number) => money(x, cur);

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

  return (
    <Screen title="Pricing rule" back={<BackLink href="/products" label="Products" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !f ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Your pricing rule">
            <Card>
              <Body muted>Sets the starting price of every product you import. You can still change any price by hand.</Body>
              <Segmented
                label="Price from cost"
                value={f.kind}
                onChange={(v) => setEdit({ ...f, kind: v })}
                options={[
                  ["multiplier", "Times the cost"],
                  ["fixed", "Cost plus an amount"],
                ]}
              />
              {f.kind === "multiplier" ? (
                <Field label="Times the supplier's cost" value={f.multiplier} onChangeText={(v) => setEdit({ ...f, multiplier: v })} keyboardType="decimal-pad" hint="2.5 turns a $8.00 cost into $20.00 before rounding." />
              ) : (
                <Field label={`Amount added to the cost (${cur})`} value={f.fixed} onChangeText={(v) => setEdit({ ...f, fixed: v })} keyboardType="decimal-pad" />
              )}
              <Segmented
                label="Prices end in"
                value={f.ending}
                onChange={(v) => setEdit({ ...f, ending: v })}
                options={[
                  ["99", ".99"],
                  ["95", ".95"],
                  ["00", ".00"],
                  ["none", "As is"],
                ]}
              />
              <Field label={`Lowest price (${cur})`} value={f.minPrice} onChangeText={(v) => setEdit({ ...f, minPrice: v })} keyboardType="decimal-pad" hint="No product starts below this." />
              <Toggle label="Show a crossed-out price" value={f.compareAt} onChange={(v) => setEdit({ ...f, compareAt: v })} />
              {f.compareAt ? <Field label="Crossed-out price, % above the price" value={f.compareAtPercent} onChangeText={(v) => setEdit({ ...f, compareAtPercent: v })} keyboardType="number-pad" /> : null}
              <Button label="Save rule" busy={busy === "save"} disabled={!!busy || !edit} onPress={() => run("save", "pricing", { method: "PUT", body: f }, () => setEdit(null))} />
            </Card>
          </Section>
          <Section title="Examples">
            <List>
              {d.examples.map((e) => (
                <Row
                  key={e.costMinor}
                  title={`Costs ${m(e.costMinor)}: sells for ${m(e.priceMinor)}${e.compareAtMinor ? `, was ${m(e.compareAtMinor)}` : ""}`}
                  subtitle={`You keep ${m(e.keepMinor)} after fees`}
                />
              ))}
            </List>
            {edit ? <Body muted>Save the rule to see its examples.</Body> : null}
          </Section>
          <Section title="Products that don't follow the rule">
            <Body muted>
              {`${d.repricing.products ? `${d.repricing.products === 1 ? "1 product has" : `${d.repricing.products} products have`} prices your rule would change.` : "Every product with a known supplier cost already follows your rule."}${d.repricing.noCost ? ` ${d.repricing.noCost === 1 ? "1 option has" : `${d.repricing.noCost} options have`} no supplier cost, so ${d.repricing.noCost === 1 ? "it's" : "they're"} left alone.` : ""}`}
            </Body>
            {d.repricing.rows.length ? (
              <>
                <List>
                  {d.repricing.rows.map((r) => (
                    <Row
                      key={r.variantId}
                      href={`/products/${r.productId}` as never}
                      title={r.title}
                      subtitle={`Costs ${m(r.costMinor)} · now ${m(r.priceMinor)} · new ${m(r.newPriceMinor)}${r.newCompareAtMinor ? `, was ${m(r.newCompareAtMinor)}` : ""}`}
                    />
                  ))}
                </List>
                {d.repricing.options > d.repricing.rows.length ? <Body muted>{`And ${d.repricing.options - d.repricing.rows.length} more.`}</Body> : null}
                {confirm ? (
                  <Button
                    label={`Update ${d.repricing.products === 1 ? "1 product" : `${d.repricing.products} products`} now`}
                    busy={busy === "apply"}
                    disabled={!!busy}
                    onPress={() => run("apply", "pricing/apply", { method: "POST" }, () => setConfirm(false))}
                  />
                ) : (
                  <Button label={`Update ${d.repricing.products === 1 ? "1 product" : `${d.repricing.products} products`}…`} kind="secondary" disabled={!!busy || !!edit} onPress={() => setConfirm(true)} />
                )}
              </>
            ) : null}
          </Section>
        </>
      )}
    </Screen>
  );
}
