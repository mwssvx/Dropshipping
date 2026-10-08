import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, View } from "react-native";
import { api, useApi } from "../../src/api";
import { FULFILMENT, money, PAYMENT, parseMoney, when } from "../../src/format";
import { BackLink, Banner, Body, Button, Card, Field, Heading, List, LoadError, Loading, Pill, Row, Screen, Section } from "../../src/ui";
import { space } from "../../src/theme";

type Detail = {
  id: string;
  number: number;
  name: string;
  email: string;
  currency: string;
  totalMinor: number;
  subtotalMinor: number;
  shippingMinor: number;
  discountMinor: number;
  discountCode: string | null;
  taxMinor: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  paidAt: string | null;
  shippingAddress: { name: string; line1: string; line2?: string; city: string; region?: string; postalCode: string; country: string };
  lines: { title: string; quantity: number; unitPriceMinor: number }[];
  fulfillments: { status: string; problemMessage: string | null; carrier: string | null; trackingNumber: string | null; trackingUrl: string | null }[];
  refunds: { amountMinor: number; reason: string | null; createdAt: string }[];
  refundableMinor: number;
};

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useApi<Detail>(`orders/${id}`);
  const [panel, setPanel] = useState<null | "refund" | "tracking">(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");

  async function run(key: string, path: string, body: unknown) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { body });
      setNote({ tone: "success", text: r.message });
      setPanel(null);
      await order.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const o = order.data;
  const back = <BackLink href="/orders" label="Orders" />;
  if (!o) return <Screen title="Order" back={back}>{order.loading ? <Loading /> : <LoadError error={order.error} stale={false} retry={order.reload} />}</Screen>;

  const f = FULFILMENT[o.fulfillmentStatus] ?? { label: o.fulfillmentStatus, tone: "neutral" as const };
  const problem = o.fulfillments.find((x) => x.problemMessage);
  const refundAmount = amount ? parseMoney(amount) : o.refundableMinor;

  return (
    <Screen title={`Order #${o.number}`} back={back} onRefresh={order.reload} refreshing={order.loading}>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <Pill label={PAYMENT[o.paymentStatus] ?? o.paymentStatus} tone={o.paymentStatus === "paid" ? "success" : "neutral"} />
        <Pill label={f.label} tone={f.tone} />
      </View>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}

      {o.fulfillmentStatus === "problem" && problem ? (
        <Card>
          <Heading>What went wrong</Heading>
          <Body>{problem.problemMessage}</Body>
          <View style={{ gap: space(2) }}>
            <Button label="Ask AI to sort it out" onPress={() => run("fix", `orders/${o.id}/fix`, {})} busy={busy === "fix"} disabled={!!busy} />
            <Button label="Try the supplier again" kind="secondary" onPress={() => run("retry", `orders/${o.id}/retry`, {})} busy={busy === "retry"} disabled={!!busy} />
            <Button label="I shipped it myself" kind="secondary" onPress={() => setPanel(panel === "tracking" ? null : "tracking")} disabled={!!busy} />
          </View>
        </Card>
      ) : null}

      {panel === "tracking" ? (
        <Card>
          <Heading>Add tracking</Heading>
          <Field label="Carrier" value={carrier} onChangeText={setCarrier} placeholder="USPS, Royal Mail…" />
          <Field label="Tracking number" value={tracking} onChangeText={setTracking} autoCapitalize="none" />
          <Button label="Save tracking" onPress={() => run("tracking", `orders/${o.id}/tracking`, { carrier, trackingNumber: tracking })} busy={busy === "tracking"} />
        </Card>
      ) : null}

      <Section title="Items">
        <List>
          {o.lines.map((l, i) => (
            <Row key={i} title={l.title} subtitle={`${l.quantity} × ${money(l.unitPriceMinor, o.currency)}`} />
          ))}
          {o.discountMinor ? <Row title={`Discount (${o.discountCode})`} right={<Body>−{money(o.discountMinor, o.currency)}</Body>} /> : null}
          <Row title="Shipping" right={<Body>{o.shippingMinor ? money(o.shippingMinor, o.currency) : "Free"}</Body>} />
          {o.taxMinor ? <Row title="Tax" right={<Body>{money(o.taxMinor, o.currency)}</Body>} /> : null}
          <Row title="Total" right={<Heading>{money(o.totalMinor, o.currency)}</Heading>} />
        </List>
      </Section>

      <Section title="Buyer">
        <Card>
          <Body>{o.shippingAddress.name}</Body>
          <Body muted>{o.email}</Body>
          <Body muted>
            {[o.shippingAddress.line1, o.shippingAddress.line2, o.shippingAddress.city, o.shippingAddress.region, o.shippingAddress.postalCode, o.shippingAddress.country].filter(Boolean).join(", ")}
          </Body>
        </Card>
      </Section>

      {o.fulfillments.some((x) => x.trackingNumber) ? (
        <Section title="Delivery">
          <List>
            {o.fulfillments
              .filter((x) => x.trackingNumber)
              .map((x, i) => (
                <Row
                  key={i}
                  title={`${x.carrier ?? "Carrier"} ${x.trackingNumber}`}
                  subtitle={FULFILMENT[x.status === "placed" ? "sent_to_supplier" : x.status]?.label ?? x.status}
                  onPress={x.trackingUrl ? () => Linking.openURL(x.trackingUrl!) : undefined}
                />
              ))}
          </List>
        </Section>
      ) : null}

      <Section title="Refunds">
        {o.refunds.map((r, i) => (
          <Body key={i} muted>
            Refunded {money(r.amountMinor, o.currency)} on {when(r.createdAt)}
            {r.reason ? `: ${r.reason}` : ""}
          </Body>
        ))}
        {o.refundableMinor > 0 ? (
          panel === "refund" ? (
            <Card>
              <Field
                label="Amount to refund"
                value={amount}
                onChangeText={setAmount}
                placeholder={(o.refundableMinor / 100).toFixed(2)}
                keyboardType="decimal-pad"
                hint={`Leave empty to refund everything left (${money(o.refundableMinor, o.currency)}).`}
              />
              <Field label="Reason (optional)" value={reason} onChangeText={setReason} />
              <Button
                label={refundAmount ? `Refund ${money(refundAmount, o.currency)}` : "Refund"}
                kind="danger"
                disabled={!refundAmount || refundAmount > o.refundableMinor}
                busy={busy === "refund"}
                onPress={() => run("refund", `orders/${o.id}/refund`, { amountMinor: amount ? refundAmount : null, reason })}
              />
              <Button label="Cancel" kind="ghost" onPress={() => setPanel(null)} />
            </Card>
          ) : (
            <Button label="Refund…" kind="secondary" onPress={() => setPanel("refund")} />
          )
        ) : o.refunds.length === 0 ? (
          <Body muted>Nothing to refund on this order.</Body>
        ) : null}
      </Section>
    </Screen>
  );
}
