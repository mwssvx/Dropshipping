import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../../src/api";
import { money, parseMoney } from "../../src/format";
import { useSession } from "../../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, LoadError, Loading, Screen, Section } from "../../src/ui";
import { space } from "../../src/theme";

type Choice = { variantId: string; title: string; sku: string | null; stock: number | null; costMinor: number | null };

/** A new restock order: who it's from, when it should come, and how many of each option. */
export default function NewRestockScreen() {
  const router = useRouter();
  const cur = useSession().me?.shop.currency ?? "USD";
  const setup = useApi<{ choices: Choice[] }>("restock/new");
  const [supplier, setSupplier] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [expected, setExpected] = useState("");
  const [note, setNote] = useState("");
  const [find, setFind] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = setup.data?.choices;
  const back = <BackLink href="/restock" label="Restock orders" />;
  if (!choices) return <Screen title="New restock order" back={back}>{setup.loading ? <Loading /> : <LoadError error={setup.error} stale={false} retry={setup.reload} />}</Screen>;
  if (!choices.length) {
    return (
      <Screen title="New restock order" back={back}>
        <EmptyState heading="No stock of your own" body="Restock orders are for products you keep and post yourself. Supplier products restock on their own." />
      </Screen>
    );
  }
  const term = find.trim().toLowerCase();
  const shown = choices.filter((c) => !term || c.title.toLowerCase().includes(term) || (c.sku ?? "").toLowerCase().includes(term)).slice(0, 30);
  const picked = choices.filter((c) => Number(qty[c.variantId]) > 0);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const lines = picked.map((c) => {
        const typed = cost[c.variantId]?.trim();
        const unit = typed ? parseMoney(typed) : null;
        if (typed && unit === null) throw new Error(`Enter the cost of ${c.title} like 4.50, or leave it empty.`);
        return { variantId: c.variantId, quantity: Number(qty[c.variantId]), unitCostMinor: unit };
      });
      const r = await api<{ id: string; message: string }>("restock", { body: { supplierName: supplier, supplierEmail, expectedOn: expected, note, lines } });
      router.replace(`/restock/${r.id}?made=${encodeURIComponent(r.message)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="New restock order" back={back}>
      {error ? <Banner tone="critical">{error}</Banner> : null}
      <Section title="From">
        <Field label="Supplier" value={supplier} onChangeText={setSupplier} placeholder="Who you're ordering from" autoCapitalize="words" />
        <Field label="Supplier's email (optional)" value={supplierEmail} onChangeText={setSupplierEmail} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Expected on (optional)" value={expected} onChangeText={setExpected} placeholder="2026-11-20" autoCapitalize="none" />
        <Field label="Note (optional)" value={note} onChangeText={setNote} multiline />
      </Section>
      <Section title={picked.length ? `What you're ordering (${picked.length})` : "What you're ordering"}>
        <Field label="Find an option" value={find} onChangeText={setFind} placeholder="Name or SKU" autoCapitalize="none" />
        {shown.map((c) => (
          <Card key={c.variantId}>
            <View role="group" aria-label={c.title} style={{ gap: space(2) }}>
              <Body>{c.title}</Body>
              <Body muted>{[c.sku, c.stock !== null ? `${c.stock} in stock` : null, c.costMinor !== null ? `costs ${money(c.costMinor, cur)}` : null].filter(Boolean).join(" · ")}</Body>
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <View style={{ flex: 1 }}>
                  <Field label={`How many ${c.title}`} value={qty[c.variantId] ?? ""} onChangeText={(v) => setQty({ ...qty, [c.variantId]: v.replace(/\D/g, "") })} keyboardType="number-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label={`Cost each of ${c.title}`} value={cost[c.variantId] ?? ""} onChangeText={(v) => setCost({ ...cost, [c.variantId]: v })} keyboardType="decimal-pad" placeholder="Optional" />
                </View>
              </View>
            </View>
          </Card>
        ))}
      </Section>
      <Button label="Save restock order" busy={busy} disabled={!supplier.trim() || !picked.length} onPress={save} />
    </Screen>
  );
}
