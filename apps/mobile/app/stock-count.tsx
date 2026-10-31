import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, LoadError, Loading, Screen } from "../src/ui";
import { space } from "../src/theme";

type Option = { variantId: string; title: string; sku: string | null; barcode: string | null; location: string | null; stock: number };

/**
 * A stock count for the stock you keep yourself: find each option by name, SKU, shelf or barcode
 * (a Bluetooth scanner types it into the search box), enter what's there, and save. Options left
 * empty aren't touched.
 */
export default function StockCountScreen() {
  const data = useApi<{ options: Option[] }>("stock-count");
  const [find, setFind] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);

  const all = data.data?.options;
  const term = find.trim().toLowerCase();
  const shown = (all ?? []).filter((o) => !term || [o.title, o.sku, o.barcode, o.location].some((x) => x?.toLowerCase().includes(term))).slice(0, 40);
  const entered = Object.entries(counts).filter(([, v]) => v !== "");
  const differ = (all ?? []).filter((o) => counts[o.variantId] !== undefined && counts[o.variantId] !== "" && Number(counts[o.variantId]) !== o.stock).length;

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("stock-count", { body: { counts: entered.map(([variantId, v]) => ({ variantId, counted: Number(v) })) } });
      setNote({ tone: "success", text: r.message });
      setCounts({});
      setFind("");
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Count stock" back={<BackLink href="/products" label="Products" />} onRefresh={data.reload} refreshing={data.loading && !!all}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!all ? (
        data.loading ? <Loading /> : null
      ) : all.length === 0 ? (
        <EmptyState heading="No stock of your own" body="Counts are for products you keep and post yourself. Supplier stock is checked on its own." />
      ) : (
        <>
          <Body muted>Enter what's on the shelf for each option you count. Ones you leave empty stay as they are. A scanner types the barcode into the search box.</Body>
          <Field label="Find by name, SKU, shelf or barcode" value={find} onChangeText={setFind} autoCapitalize="none" />
          {shown.map((o) => {
            const typed = counts[o.variantId] ?? "";
            const diff = typed === "" ? 0 : Number(typed) - o.stock;
            return (
              <Card key={o.variantId}>
                <View role="group" aria-label={o.title} style={{ gap: space(1) }}>
                  <Body>{o.title}</Body>
                  <Body muted>{[o.location ? `Shelf ${o.location}` : null, o.sku, `${o.stock} expected`].filter(Boolean).join(" · ")}</Body>
                  <Field
                    label={`Counted ${o.title}`}
                    value={typed}
                    onChangeText={(v) => setCounts({ ...counts, [o.variantId]: v.replace(/\D/g, "") })}
                    keyboardType="number-pad"
                    hint={typed === "" ? undefined : diff === 0 ? "Matches." : diff < 0 ? `${-diff} missing.` : `${diff} more than expected.`}
                  />
                </View>
              </Card>
            );
          })}
          {all.length > shown.length && !term ? <Body muted>{`Showing ${shown.length} of ${all.length}. Search to find the rest.`}</Body> : null}
          <Button
            label={entered.length ? `Save the count (${differ === 0 ? "all match" : differ === 1 ? "1 change" : `${differ} changes`})` : "Save the count"}
            busy={busy}
            disabled={!entered.length}
            onPress={save}
          />
        </>
      )}
    </Screen>
  );
}
