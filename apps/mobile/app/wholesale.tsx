import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../src/api";
import { money, when } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, LoadError, Loading, Screen, Section, Toggle } from "../src/ui";
import { space } from "../src/theme";

type Buyer = { id: string; email: string; company: string | null; taxId: string | null; message: string | null; requestedAt: string | null };
type Data = { enabled: boolean; percentOff: number; minOrderMinor: number; pending: Buyer[]; buyers: Buyer[] };

/**
 * Selling to shops and businesses at a lower price: answer their applications, add buyers you
 * already know, take wholesale prices away, and set the discount and smallest order.
 */
export default function WholesaleScreen() {
  const data = useApi<Data>("wholesale");
  const cur = useSession().me?.shop.currency ?? "USD";
  const [settings, setSettings] = useState<{ enabled: boolean; percentOff: string; minOrder: string } | null>(null);
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const s = settings ?? (d ? { enabled: d.enabled, percentOff: String(d.percentOff), minOrder: d.minOrderMinor ? (d.minOrderMinor / 100).toFixed(2) : "" } : null);

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
  const decide = (b: Buyer, decision: "approve" | "decline" | "remove") => run(`${decision}:${b.id}`, `wholesale/${b.id}`, { body: { decision } }, () => setConfirm(null));

  return (
    <Screen title="Wholesale" back={<BackLink href="/customers" label="Customers" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !s ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Approved buyers sign in on your store and see wholesale prices everywhere.</Body>
          {!d.enabled ? <Banner tone="info">Wholesale is off, so buyers can't apply and approved ones pay the normal prices. Turn it on below.</Banner> : null}
          <Section title={d.pending.length ? `Applications (${d.pending.length})` : "Applications"}>
            {d.pending.length === 0 ? (
              <EmptyState heading="No applications waiting" body="Businesses apply from their account page on your store." />
            ) : (
              d.pending.map((b) => (
                <Card key={b.id}>
                  <View role="group" aria-label={b.company ?? b.email} style={{ gap: space(1) }}>
                    <Heading>{b.company ?? b.email}</Heading>
                    <Body muted>{[b.email, b.taxId ? `Tax or resale number ${b.taxId}` : null, b.requestedAt ? `Applied ${when(b.requestedAt)}` : null].filter(Boolean).join(" · ")}</Body>
                    {b.message ? <Body>{b.message}</Body> : null}
                    <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                      <Button label="Approve" busy={busy === `approve:${b.id}`} disabled={!!busy} onPress={() => decide(b, "approve")} a11y={`Approve ${b.company ?? b.email}`} />
                      <Button label="Decline" kind="secondary" busy={busy === `decline:${b.id}`} disabled={!!busy} onPress={() => decide(b, "decline")} a11y={`Decline ${b.company ?? b.email}`} />
                    </View>
                  </View>
                </Card>
              ))
            )}
          </Section>
          <Section title="Wholesale buyers">
            {d.buyers.length === 0 ? <Body muted>None yet. Approve an application, or add a buyer you already know.</Body> : null}
            {d.buyers.map((b) => (
              <Card key={b.id}>
                <View role="group" aria-label={b.company ?? b.email} style={{ gap: space(1) }}>
                  <Heading>{b.company ?? b.email}</Heading>
                  {b.company ? <Body muted>{b.email}</Body> : null}
                  {confirm === b.id ? (
                    <>
                      <Body muted>They pay the normal prices from their next order.</Body>
                      <Button label={`Remove ${b.company ?? b.email}`} kind="danger" busy={busy === `remove:${b.id}`} disabled={!!busy} onPress={() => decide(b, "remove")} />
                    </>
                  ) : (
                    <Button label="Remove…" kind="secondary" onPress={() => setConfirm(b.id)} a11y={`Remove ${b.company ?? b.email}…`} />
                  )}
                </View>
              </Card>
            ))}
            <Card>
              <Heading>Add a buyer you know</Heading>
              <Field label="Buyer's email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
              <Field label="Business name (optional)" value={company} onChangeText={setCompany} />
              <Button
                label="Add wholesale buyer"
                busy={busy === "add"}
                disabled={!!busy || !email.trim()}
                onPress={() => run("add", "wholesale/buyers", { body: { email, company } }, () => { setEmail(""); setCompany(""); })}
              />
            </Card>
          </Section>
          <Section title="Settings">
            <Card>
              <Toggle label="Sell wholesale" value={s.enabled} onChange={(v) => setSettings({ ...s, enabled: v })} />
              <Field label="Wholesale discount (%)" value={s.percentOff} onChangeText={(v) => setSettings({ ...s, percentOff: v })} keyboardType="number-pad" />
              <Field
                label="Smallest wholesale order"
                value={s.minOrder}
                onChangeText={(v) => setSettings({ ...s, minOrder: v })}
                keyboardType="decimal-pad"
                placeholder="No minimum"
                hint={d.minOrderMinor ? `Now ${money(d.minOrderMinor, cur)}. Leave it empty for no minimum.` : "Leave it empty for no minimum."}
              />
              <Button label="Save settings" kind="secondary" busy={busy === "settings"} disabled={!!busy} onPress={() => run("settings", "wholesale", { method: "PUT", body: s }, () => setSettings(null))} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
