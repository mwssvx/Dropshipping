import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, List, LoadError, Loading, Pill, Row, Screen, Section, Segmented } from "../src/ui";
import { space } from "../src/theme";

type Kind = "spent" | "orders" | "bought" | "lapsed";
type Data = { rules: { id: string; tag: string; describe: string; customers: number }[]; max: number; products: { id: string; title: string }[] };
const EMPTY = { kind: "spent" as Kind, tag: "", amount: "", orders: "", days: "90", productId: "" };

/**
 * Tags customers get while they match ("spent $200 or more" gets vip, "no order in 90 days" gets
 * lapsed) and lose when they stop, so a tag can be trusted for a campaign or a code.
 */
export default function TagRulesScreen() {
  const data = useApi<Data>("tag-rules");
  const cur = useSession().me?.shop.currency ?? "USD";
  const [form, setForm] = useState(EMPTY);
  const [find, setFind] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const set = (k: keyof typeof EMPTY) => (v: string) => setForm({ ...form, [k]: v });

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

  const shown = (d?.products ?? []).filter((p) => p.title.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 20);
  const ready = form.tag.trim() && (form.kind === "spent" ? form.amount.trim() : form.kind === "orders" ? form.orders.trim() : form.kind === "lapsed" ? form.days.trim() : form.productId);

  return (
    <Screen title="Tag customers automatically" back={<BackLink href="/customers" label="Customers" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>A rule gives its tag to every customer who matches and takes it off when they stop matching. Tags you typed by hand stay yours.</Body>
          <Section title={`Your rules (${d.rules.length} of ${d.max})`}>
            {d.rules.length === 0 ? <EmptyState heading="No rules yet" body="Try “Spent at least $200” for vip, or “Haven't ordered in 90 days” for lapsed." /> : null}
            {d.rules.map((r) => (
              <Card key={r.id}>
                <View role="group" aria-label={`${r.describe}: ${r.tag}`} style={{ gap: space(1) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                    <Heading>{r.describe}</Heading>
                    <Pill label={r.tag} />
                  </View>
                  <Body muted>{`${r.customers} ${r.customers === 1 ? "customer has" : "customers have"} the tag now`}</Body>
                  {confirm === r.id ? (
                    <Button label={`Remove the ${r.tag} rule`} kind="danger" busy={busy === `del:${r.id}`} disabled={!!busy} onPress={() => run(`del:${r.id}`, `tag-rules/${r.id}`, { method: "DELETE" }, () => setConfirm(null))} />
                  ) : (
                    <Button label="Remove…" kind="ghost" a11y={`Remove the ${r.tag} rule…`} disabled={!!busy} onPress={() => setConfirm(r.id)} />
                  )}
                </View>
              </Card>
            ))}
          </Section>
          <Section title="New rule">
            <Card>
              <Segmented
                label="Customers who"
                value={form.kind}
                onChange={(k) => setForm({ ...form, kind: k })}
                options={[["spent", "Spent"], ["orders", "Ordered"], ["bought", "Bought"], ["lapsed", "Stopped"]]}
              />
              {form.kind === "spent" ? <Field label="Spent at least" value={form.amount} onChangeText={set("amount")} keyboardType="decimal-pad" placeholder={money(20000, cur)} hint="After refunds." /> : null}
              {form.kind === "orders" ? <Field label="Placed at least (orders)" value={form.orders} onChangeText={set("orders")} keyboardType="number-pad" placeholder="3" /> : null}
              {form.kind === "lapsed" ? <Field label="Haven't ordered in (days)" value={form.days} onChangeText={set("days")} keyboardType="number-pad" hint="At least 7 days." /> : null}
              {form.kind === "bought" ? (
                <>
                  <Field label="Find a product" value={find} onChangeText={setFind} />
                  <List>
                    {shown.map((p) => (
                      <Row key={p.id} title={p.title} onPress={() => setForm({ ...form, productId: p.id })} right={form.productId === p.id ? <Pill label="Picked" tone="success" /> : undefined} a11y={`Pick ${p.title}`} />
                    ))}
                  </List>
                </>
              ) : null}
              <Field label="Get the tag" value={form.tag} onChangeText={set("tag")} autoCapitalize="none" placeholder="vip" />
              <Button label="Add rule" busy={busy === "add"} disabled={!!busy || !ready} onPress={() => run("add", "tag-rules", { body: form }, () => setForm(EMPTY))} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
