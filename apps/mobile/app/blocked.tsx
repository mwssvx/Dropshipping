import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../src/api";
import { when } from "../src/format";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, LoadError, Loading, Pill, Row, List, Screen, Section } from "../src/ui";
import { space } from "../src/theme";

type Blocked = { id: string; kind: "email" | "address"; label: string; note: string | null; orderId: string | null; orderNumber: number | null; createdAt: string };

/** Emails and delivery addresses checkout turns away before they pay. */
export default function BlockedScreen() {
  const list = useApi<{ blocked: Blocked[] }>("blocked");
  const [email, setEmail] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function run(key: string, path: string, init: { method?: string; body?: unknown }) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, init);
      setNote({ tone: "success", text: r.message });
      setConfirm(null);
      if (key === "add") {
        setEmail("");
        setWhy("");
      }
      await list.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const rows = list.data?.blocked;
  return (
    <Screen title="Blocked buyers" back={<BackLink href="/customers" label="Customers" />} onRefresh={list.reload} refreshing={list.loading && !!rows}>
      <Body muted>Checkout turns these away before they pay, as on the website. Block from an order to cover both the buyer's email and their address.</Body>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <Card>
        <Heading>Block an email</Heading>
        <Field label="Email to block" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Why (only your team sees this)" value={why} onChangeText={setWhy} />
        <Button label="Block this email" kind="danger" busy={busy === "add"} disabled={!email.trim() || !!busy} onPress={() => run("add", "blocked", { body: { email, note: why } })} />
      </Card>
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!rows ? (
        list.loading ? <Loading /> : null
      ) : rows.length === 0 ? (
        <EmptyState heading="Nobody is blocked" body="Block a buyer from their order, or an email here, after a chargeback, a stolen card or return abuse." />
      ) : (
        <Section title={`Blocked (${rows.length})`}>
          {rows.map((b) => (
            <Card key={b.id}>
              <View role="article" aria-label={`Blocked ${b.label}`} style={{ gap: space(2) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <Body>{b.label}</Body>
                  <Pill label={b.kind === "email" ? "Email" : "Address"} />
                </View>
                <Body muted>{[`Since ${when(b.createdAt)}`, b.note].filter(Boolean).join(" · ")}</Body>
                {b.orderId && b.orderNumber ? (
                  <List>
                    <Row href={`/orders/${b.orderId}` as never} title={`From order #${b.orderNumber}`} />
                  </List>
                ) : null}
                {confirm === b.id ? (
                  <>
                    <Body>They can check out again straight away.</Body>
                    <Button label={`Unblock ${b.label}`} busy={busy === b.id} onPress={() => run(b.id, `blocked/${b.id}`, { method: "DELETE" })} />
                    <Button label="Keep blocked" kind="ghost" onPress={() => setConfirm(null)} />
                  </>
                ) : (
                  <Button label="Unblock…" kind="ghost" a11y={`Unblock ${b.label}…`} disabled={!!busy} onPress={() => setConfirm(b.id)} />
                )}
              </View>
            </Card>
          ))}
        </Section>
      )}
    </Screen>
  );
}
