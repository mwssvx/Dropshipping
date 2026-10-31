import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../../src/api";
import { money, when } from "../../src/format";
import { Banner, Body, Button, Card, EmptyState, Field, Heading, List, LoadError, Loading, Pill, Row, Screen, Section, Segmented, Stat } from "../../src/ui";
import { color, space } from "../../src/theme";

type Money = {
  currency: string;
  /** Disputes waiting for an answer. */
  disputesOpen?: number;
  availableMinor: number;
  pendingMinor: number;
  onTheWayMinor: number;
  paidOutMinor: number;
  payoutsEnabled: boolean;
  last30: { orders: number; salesMinor: number; refundsMinor: number; platformFeesMinor: number; processingFeesMinor: number; supplierCostsMinor: number; shippingMinor: number; taxMinor: number; profitMinor: number; adsMinor: number; profitAfterAdsMinor: number };
  topProducts: { title: string; units: number; profitMinor: number; adsMinor: number; roas: number | null }[];
  payouts: { id: string; amountMinor: number; status: string; arrivalDate: string | null }[];
  holds: { id: string; title: string; explanation: string; holdsPayouts: boolean; dueBy: string | null; submittedAt: string | null; upload: boolean }[];
};

type Channel = "meta" | "google" | "tiktok" | "other";
const CHANNELS: [Channel, string][] = [["meta", "Meta"], ["google", "Google"], ["tiktok", "TikTok"], ["other", "Other"]];

/** "25", "25.5" or "$25.00" to 2500; null when it isn't an amount. */
function toMinor(raw: string) {
  const m = raw.replace(/[^\d.,]/g, "").replace(",", ".").match(/^(\d+)(?:\.(\d{1,2}))?$/);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) : null;
}

const PAYOUT: Record<string, string> = { pending: "Scheduled", in_transit: "On the way", paid: "Paid", failed: "Failed", canceled: "Cancelled" };

export default function MoneyScreen() {
  const m = useApi<Money>("money");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const [channel, setChannel] = useState<Channel>("meta");
  const [spent, setSpent] = useState("");
  const d = m.data;

  async function addSpend() {
    const amountMinor = toMinor(spent);
    if (!amountMinor) return setNote({ tone: "critical", text: "Enter how much you spent today, like 25.00." });
    setBusy("ads");
    setNote(null);
    try {
      const res = await api<{ message: string }>("money/ad-spend", { method: "POST", body: { channel, amountMinor } });
      setNote({ tone: "success", text: res.message });
      setSpent("");
      await m.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function sendDocument(holdId: string, fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setNote({ tone: "critical", text: "Allow access in Settings to send a photo of the document." });
    const r = fromCamera ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (r.canceled || !r.assets[0]) return;
    const asset = r.assets[0];
    setBusy(holdId);
    setNote(null);
    try {
      const blob = await (await fetch(asset.uri)).blob();
      const type = asset.mimeType === "image/png" ? "image/png" : "image/jpeg";
      const res = await api<{ message: string }>(`money/holds/${holdId}/document`, { raw: { data: blob, type } });
      setNote({ tone: "success", text: res.message });
      await m.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Money" onRefresh={m.reload} refreshing={m.loading && !!d}>
      <LoadError error={m.error} stale={m.stale} retry={m.reload} />
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      {!d ? (
        m.loading ? <Loading /> : null
      ) : (
        <>
          {d.holds
            .filter((h) => !h.submittedAt)
            .map((h) => (
              <Card key={h.id}>
                <View role="article" aria-label={h.title} style={{ gap: space(2) }}>
                  {h.holdsPayouts ? <Pill label="Payouts paused" tone="critical" /> : <Pill label="Needed soon" tone="warning" />}
                  <Heading>{h.title}</Heading>
                  <Body>{h.explanation}</Body>
                  {h.dueBy ? <Body muted>Send by {when(h.dueBy)}.</Body> : null}
                  {h.upload ? (
                    <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                      <Button label="Take a photo of it" onPress={() => sendDocument(h.id, true)} busy={busy === h.id} />
                      <Button label="Choose a photo" kind="secondary" onPress={() => sendDocument(h.id, false)} disabled={busy === h.id} />
                    </View>
                  ) : (
                    <Body muted>Update these details on the web: Money, then Update details.</Body>
                  )}
                </View>
              </Card>
            ))}
          {d.holds.filter((h) => h.submittedAt).map((h) => (
            <Banner key={h.id} tone="info">
              {h.title}: sent {when(h.submittedAt)}. We'll tell you when it's checked.
            </Banner>
          ))}

          <List>
            <View style={{ flexDirection: "row", gap: 1 }}>
              <Stat label="Ready to pay out" value={money(d.availableMinor, d.currency)} />
              <Stat label="Clearing" value={money(d.pendingMinor, d.currency)} />
            </View>
            <View style={{ flexDirection: "row", gap: 1 }}>
              <Stat label="On the way to your bank" value={money(d.onTheWayMinor, d.currency)} />
              <Stat label="Paid out so far" value={money(d.paidOutMinor, d.currency)} />
            </View>
          </List>
          {!d.payoutsEnabled && d.holds.length === 0 ? <Banner tone="warning">Payouts aren't set up yet. Set them up on the web under Money so you get paid.</Banner> : null}

          <Section title="Last 30 days">
            <List>
              <Row title="Sales" subtitle={`${d.last30.orders} orders`} right={<Body>{money(d.last30.salesMinor, d.currency)}</Body>} />
              <Row title="Supplier costs" right={<Body>−{money(d.last30.supplierCostsMinor, d.currency)}</Body>} />
              <Row title="Shipping and tax collected" subtitle="Passed on to the supplier and the tax office" right={<Body>−{money(d.last30.shippingMinor + d.last30.taxMinor, d.currency)}</Body>} />
              <Row title="Fees" subtitle="Card processing and our sales fee" right={<Body>−{money(d.last30.processingFeesMinor + d.last30.platformFeesMinor, d.currency)}</Body>} />
              <Row title="Ad spend" subtitle="What you entered" right={<Body>−{money(d.last30.adsMinor, d.currency)}</Body>} />
              <Row title="Profit after ads" right={<Heading>{money(d.last30.profitAfterAdsMinor, d.currency)}</Heading>} />
            </List>
          </Section>

          <Section title="Today's ad spend">
            <Card>
              <View style={{ gap: space(3) }}>
                <Segmented label="Where the ads ran" options={CHANNELS} value={channel} onChange={setChannel} />
                <Field label="Amount spent" value={spent} onChangeText={setSpent} keyboardType="decimal-pad" placeholder="25.00" onSubmit={addSpend} />
                <Button label="Add ad spend" onPress={addSpend} busy={busy === "ads"} />
              </View>
            </Card>
          </Section>

          {d.topProducts.length ? (
            <Section title="Products by profit">
              <List>
                {d.topProducts.map((p) => (
                  <Row
                    key={p.title}
                    title={p.title}
                    subtitle={`${p.units} sold${p.roas != null ? ` · ROAS ${p.roas}×` : ""}`}
                    right={<Body style={p.profitMinor < 0 ? { color: color.critical } : undefined}>{money(p.profitMinor, d.currency)}</Body>}
                  />
                ))}
              </List>
            </Section>
          ) : null}

          <List>
            <Row
              href="/disputes"
              title={d.disputesOpen ? `Disputes (${d.disputesOpen} to answer)` : "Disputes"}
              subtitle={d.disputesOpen ? "A buyer's bank is pulling money back. Send the evidence before the deadline." : "When a buyer's bank pulls a payment back"}
              right={d.disputesOpen ? <Pill label="Answer" tone="critical" /> : undefined}
            />
          </List>

          <Section title="Payouts">
            {d.payouts.length === 0 ? (
              <EmptyState heading="No payouts yet" body="Money from sales is paid to your bank about two days after each sale clears." />
            ) : (
              <List>
                {d.payouts.map((p) => (
                  <Row key={p.id} title={money(p.amountMinor, d.currency)} subtitle={p.arrivalDate ? `Arrives ${when(p.arrivalDate)}` : undefined} right={<Pill label={PAYOUT[p.status] ?? p.status} tone={p.status === "paid" ? "success" : p.status === "failed" ? "critical" : "info"} />} />
                ))}
              </List>
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}
