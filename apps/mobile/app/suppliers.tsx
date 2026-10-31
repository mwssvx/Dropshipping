import { useState } from "react";
import { Share, View } from "react-native";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, List, LoadError, Loading, Pill, Row, Screen, Section } from "../src/ui";
import { space } from "../src/theme";

type Grade = "good" | "watch" | "poor" | "too_few";
type Score = {
  id: string;
  name: string;
  orders: number;
  failed: number;
  failedRate: number;
  shipDays: number | null;
  deliverDays: number | null;
  problems: number;
  problemRate: number;
  grade: Grade;
  late: number;
  productsWithoutBackup: number;
};
type Own = { id: string; name: string; email: string; link: string; products: number; openOrders: number };
type Data = { minOrders: number; scores: Score[]; services: { name: string; label: string; connected: boolean }[]; own: Own[] };

const GRADE: Record<Grade, { label: string; tone: "success" | "warning" | "critical" | "neutral" }> = {
  good: { label: "Good", tone: "success" },
  watch: { label: "Watch", tone: "warning" },
  poor: { label: "Poor", tone: "critical" },
  too_few: { label: "Too few orders", tone: "neutral" },
};
const days = (d: number | null) => (d == null ? "–" : `${d} ${d === 1 ? "day" : "days"}`);
const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * How each supplier is doing over the last 90 days, and your own suppliers (wholesalers, makers):
 * add one, send them their private link, change or remove them.
 */
export default function SuppliersScreen() {
  const data = useApi<Data>("suppliers");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string; email: string } | null>(null);
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

  const share = (o: Own) => void Share.share({ message: `Here's where to see our orders and add tracking: ${o.link}`, url: o.link });

  return (
    <Screen title="Suppliers" back={<BackLink href="/products" label="Products" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>When a buyer pays, each item goes to its supplier by itself, and tracking comes back to you and the buyer.</Body>
          {d.scores.length ? (
            <Section title="How they're doing">
              <Body muted>{`Your orders from the last 90 days. Problems are orders that never arrived, arrived damaged or wrong, or that you replaced. Grades need ${d.minOrders} orders.`}</Body>
              {d.scores.map((s) => (
                <Card key={s.id}>
                  <View role="group" aria-label={s.name} style={{ gap: space(1) }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                      <Heading>{s.name}</Heading>
                      <Pill label={GRADE[s.grade].label} tone={GRADE[s.grade].tone} />
                    </View>
                    <Body>{`${count(s.orders, "order")} · ships in ${days(s.shipDays)} · arrives in ${days(s.deliverDays)}`}</Body>
                    <Body muted>{`Couldn't take ${s.failed} (${s.failedRate}%) · problems ${s.problems} (${s.problemRate}%)`}</Body>
                    {s.late ? <Banner tone="warning">{`Hasn't shipped ${count(s.late, "order")} placed over a week ago.`}</Banner> : null}
                    {s.productsWithoutBackup ? (
                      <Body muted>{`${count(s.productsWithoutBackup, "product")} from ${s.name} ${s.productsWithoutBackup === 1 ? "has" : "have"} no backup supplier. Add one on the website so orders still go out.`}</Body>
                    ) : null}
                  </View>
                </Card>
              ))}
            </Section>
          ) : null}
          <Section title="Your own suppliers">
            <Body muted>Any wholesaler, warehouse or maker you work with. Paid orders for their products are emailed to them with the address (never the buyer's email) and a private link to add tracking. They don't need an account.</Body>
            {d.own.length === 0 ? <EmptyState heading="None yet" body="Add one below." /> : null}
            {d.own.map((o) => (
              <Card key={o.id}>
                <View role="group" aria-label={o.name} style={{ gap: space(1) }}>
                  {editing?.id === o.id ? (
                    <>
                      <Field label="Name" value={editing.name} onChangeText={(v) => setEditing({ ...editing, name: v })} />
                      <Field label="Email" value={editing.email} onChangeText={(v) => setEditing({ ...editing, email: v })} keyboardType="email-address" autoCapitalize="none" />
                      <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                        <Button label="Save" busy={busy === `edit:${o.id}`} disabled={!!busy} onPress={() => run(`edit:${o.id}`, `suppliers/${o.id}`, { method: "PATCH", body: { name: editing.name, email: editing.email } }, () => setEditing(null))} />
                        <Button label="Cancel" kind="secondary" onPress={() => setEditing(null)} />
                      </View>
                    </>
                  ) : (
                    <>
                      <Heading>{o.name}</Heading>
                      <Body muted>{`${o.email} · ${count(o.products, "product")}${o.openOrders ? ` · ${count(o.openOrders, "order")} to send` : ""}`}</Body>
                      <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                        <Button label="Share their link" kind="secondary" onPress={() => share(o)} a11y={`Share ${o.name}'s link`} />
                        <Button label="Change" kind="secondary" onPress={() => setEditing({ id: o.id, name: o.name, email: o.email })} a11y={`Change ${o.name}`} />
                        <Button
                          label="New link"
                          kind="secondary"
                          busy={busy === `link:${o.id}`}
                          disabled={!!busy}
                          a11y={`Give ${o.name} a new link`}
                          onPress={() => run(`link:${o.id}`, `suppliers/${o.id}/new-link`, { method: "POST" })}
                        />
                        {confirm === o.id ? (
                          <Button label={`Remove ${o.name}`} kind="danger" busy={busy === `del:${o.id}`} disabled={!!busy} onPress={() => run(`del:${o.id}`, `suppliers/${o.id}`, { method: "DELETE" }, () => setConfirm(null))} />
                        ) : (
                          <Button label="Remove…" kind="secondary" onPress={() => setConfirm(o.id)} a11y={`Remove ${o.name}…`} />
                        )}
                      </View>
                      {confirm === o.id ? <Body muted>Their products go back to having no supplier, and their link stops working.</Body> : null}
                    </>
                  )}
                </View>
              </Card>
            ))}
            <Card>
              <Heading>Add a supplier</Heading>
              <Field label="Supplier name" value={name} onChangeText={setName} placeholder="Northwind Wholesale" />
              <Field label="Supplier email" value={email} onChangeText={setEmail} placeholder="orders@northwind.example" keyboardType="email-address" autoCapitalize="none" />
              <Button
                label="Add supplier"
                busy={busy === "add"}
                disabled={!!busy || !name.trim() || !email.trim()}
                onPress={() => run("add", "suppliers", { method: "POST", body: { name, email } }, () => { setName(""); setEmail(""); })}
              />
            </Card>
          </Section>
          <Section title="Connected services">
            <List>
              {d.services.map((s) => (
                <Row key={s.name} title={s.label} subtitle={s.connected ? "Products import from its links and orders go to it" : "Set up on the website"} right={<Pill label={s.connected ? "Connected" : "Not connected"} tone={s.connected ? "success" : "neutral"} />} />
              ))}
            </List>
          </Section>
        </>
      )}
    </Screen>
  );
}
