import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, View } from "react-native";
import { api, useApi } from "../../src/api";
import { FULFILMENT, money, PAYMENT, parseMoney, when } from "../../src/format";
import { BackLink, Banner, Body, Button, Card, Field, Heading, List, LoadError, Loading, Pill, Row, Screen, Section, Toggle } from "../../src/ui";
import { space } from "../../src/theme";
import { useCan } from "../../src/session";

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
  bundleTitle?: string | null;
  taxMinor: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  paidAt: string | null;
  shippingAddress: { name: string; line1: string; line2?: string; city: string; region?: string; postalCode: string; country: string; phone?: string };
  lines: { title: string; quantity: number; unitPriceMinor: number; personalization?: string | null }[];
  fulfillments: { status: string; problemMessage: string | null; backupNote?: string | null; carrier: string | null; trackingNumber: string | null; trackingUrl: string | null }[];
  refunds: { amountMinor: number; reason: string | null; createdAt: string }[];
  refundableMinor: number;
  held?: boolean;
  risk?: { level: "low" | "medium" | "high"; reasons: string[] } | null;
  buyerNote?: string | null;
  staffNote?: string | null;
  tags?: string[];
  expectedDelivery?: { from: string; to: string } | null;
  daysLate?: number;
  /** Set when it comes in more than one parcel. */
  parcels?: { own: boolean; items: { title: string; quantity: number }[]; status: string | null; carrier: string | null; trackingNumber: string | null; trackingUrl: string | null }[];
  /** The buyer's other orders to the same address that haven't shipped. */
  sameAddress?: { orders: { id: string; number: number; createdAt: string; ownItems: boolean }[]; oneBox: boolean } | null;
  /** The store's own items wait to be posted. `own`: only part of the order, the rest comes from a supplier. */
  postYourself?: { own: boolean } | null;
};

/** Where one parcel of several is: shipped with tracking, with the supplier, or still to post yourself. */
const parcelState = (p: NonNullable<Detail["parcels"]>[number]) =>
  p.status === "delivered"
    ? "Delivered"
    : p.trackingNumber
      ? `${p.carrier ?? "Carrier"} ${p.trackingNumber}`
      : p.own
        ? "Sent by you · not shipped yet"
        : p.status === "failed"
          ? "Supplier couldn't take it"
          : "With the supplier · not shipped yet";

const longDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** "Oct 18 – Oct 25", or one day when both ends are the same. */
const span = (w: { from: string; to: string }) => {
  const [a, b] = [longDay.format(new Date(w.from)), longDay.format(new Date(w.to))];
  return a === b ? a : `${a} – ${b}`;
};

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useApi<Detail>(`orders/${id}`);
  const can = useCan();
  const [panel, setPanel] = useState<null | "refund" | "tracking">(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [also, setAlso] = useState<string[]>([]);

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

      {o.held ? (
        <Card>
          <Heading>On hold: {o.risk?.level === "high" ? "high" : "medium"} risk</Heading>
          <Body>This order looked risky, so it hasn't gone to the supplier. If it's a stolen card, refunding now means you don't pay for the goods.</Body>
          {(o.risk?.reasons ?? []).map((r, i) => (
            <Body key={i} muted>• {r}</Body>
          ))}
          <View style={{ gap: space(2) }}>
            <Button label="It's fine, send it" onPress={() => run("release", `orders/${o.id}/release`, {})} busy={busy === "release"} disabled={!!busy} />
            {can("refunds") ? <Button label="Refund it" kind="secondary" onPress={() => { setReason("Looked like fraud"); setPanel("refund"); }} disabled={!!busy} /> : null}
          </View>
        </Card>
      ) : null}

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

      {o.postYourself && panel !== "tracking" ? (
        <Card>
          <Heading>{o.postYourself.own ? "Your own parcel" : "Post it yourself"}</Heading>
          <Body muted>{`${o.postYourself.own ? "Part of this order is your own stock, so you post it. The supplier sends the rest." : "This order is your own stock, so you post it."} Add the tracking once it's sent and the buyer gets an email.`}</Body>
          <Button label="Add tracking" onPress={() => setPanel("tracking")} disabled={!!busy} />
        </Card>
      ) : null}

      {panel === "tracking" ? (
        <Card>
          <Heading>Add tracking</Heading>
          <Field label="Carrier" value={carrier} onChangeText={setCarrier} placeholder="USPS, Royal Mail…" />
          <Field label="Tracking number" value={tracking} onChangeText={setTracking} autoCapitalize="none" />
          {o.postYourself && o.sameAddress?.oneBox
            ? o.sameAddress.orders.filter((x) => x.ownItems).map((x) => (
                <Toggle key={x.id} label={`Order #${x.number} gets this tracking too`} value={also.includes(x.id)} onChange={(on) => setAlso(on ? [...also, x.id] : also.filter((a) => a !== x.id))} />
              ))
            : null}
          <Button label="Save tracking" onPress={() => run("tracking", `orders/${o.id}/tracking`, { carrier, trackingNumber: tracking, own: !!o.postYourself?.own, also })} busy={busy === "tracking"} />
        </Card>
      ) : null}

      <Section title="Items">
        <List>
          {o.lines.map((l, i) => (
            <Row key={i} title={l.title} subtitle={`${l.quantity} × ${money(l.unitPriceMinor, o.currency)}${l.personalization ? `\n${l.personalization}` : ""}`} />
          ))}
          {o.discountMinor ? <Row title={o.discountCode ? `Discount (${o.discountCode})` : `Bundle (${o.bundleTitle})`} right={<Body>−{money(o.discountMinor, o.currency)}</Body>} /> : null}
          <Row title="Shipping" right={<Body>{o.shippingMinor ? money(o.shippingMinor, o.currency) : "Free"}</Body>} />
          {o.taxMinor ? <Row title="Tax" right={<Body>{money(o.taxMinor, o.currency)}</Body>} /> : null}
          <Row title="Total" right={<Heading>{money(o.totalMinor, o.currency)}</Heading>} />
        </List>
      </Section>

      {o.sameAddress ? (
        <Section title="Also going to this address">
          <List>
            {o.sameAddress.orders.map((x) => (
              <Row key={x.id} title={`Order #${x.number}`} subtitle={`${when(x.createdAt)}${x.ownItems ? " · has items you post" : ""}`} href={`/orders/${x.id}`} />
            ))}
          </List>
          <Body muted>
            {o.sameAddress.oneBox
              ? "The items you post yourself can go in one box, so you pay postage once. Add the same tracking to each order."
              : "Suppliers send their parcels on their own, so these may still arrive on different days."}
          </Body>
        </Section>
      ) : null}

      <Section title="Buyer">
        <Card>
          <Body>{o.shippingAddress.name}</Body>
          <Body muted>{o.email}</Body>
          <Body muted>
            {[o.shippingAddress.line1, o.shippingAddress.line2, o.shippingAddress.city, o.shippingAddress.region, o.shippingAddress.postalCode, o.shippingAddress.country].filter(Boolean).join(", ")}
          </Body>
          {o.shippingAddress.phone ? (
            <Button kind="secondary" label={`Call ${o.shippingAddress.phone}`} onPress={() => void Linking.openURL(`tel:${o.shippingAddress.phone!.replace(/[^\d+]/g, "")}`)} />
          ) : null}
          {o.buyerNote ? <Body>Their note: {o.buyerNote}</Body> : null}
        </Card>
      </Section>

      {o.staffNote || o.tags?.length ? (
        <Section title="Your note and tags">
          <Card>
            {o.tags?.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
                {o.tags.map((t) => <Pill key={t} label={t} />)}
              </View>
            ) : null}
            {o.staffNote ? <Body>{o.staffNote}</Body> : null}
          </Card>
        </Section>
      ) : null}

      {o.fulfillments.some((x) => x.backupNote && x.status !== "cancelled") ? (
        <Banner tone="info">{o.fulfillments.find((x) => x.backupNote && x.status !== "cancelled")!.backupNote}</Banner>
      ) : null}

      {o.expectedDelivery ? (
        <Card>
          <Body>{o.fulfillmentStatus === "shipped" ? "Should arrive" : "Expected to arrive"} {span(o.expectedDelivery)}</Body>
          {o.daysLate ? <Pill tone="warning" label={`${o.daysLate === 1 ? "1 day" : `${o.daysLate} days`} past its delivery date`} /> : null}
        </Card>
      ) : null}

      {o.parcels && o.parcels.length > 1 ? (
        <Section title={`Comes in ${o.parcels.length} parcels`}>
          <List>
            {o.parcels.map((p, i) => (
              <Row
                key={i}
                title={p.items.map((it) => (it.quantity > 1 ? `${it.title} × ${it.quantity}` : it.title)).join(", ")}
                subtitle={parcelState(p)}
                onPress={p.trackingUrl ? () => Linking.openURL(p.trackingUrl!) : undefined}
              />
            ))}
          </List>
        </Section>
      ) : o.fulfillments.some((x) => x.trackingNumber) ? (
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

      {can("refunds") && <Section title="Refunds">
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
      </Section>}
    </Screen>
  );
}
