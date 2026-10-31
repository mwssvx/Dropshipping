import { useState } from "react";
import { View } from "react-native";
import { send, useApi } from "../../src/api";
import { money, parseMoney, when } from "../../src/format";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, LoadError, Loading, Pill, Screen, Segmented } from "../../src/ui";
import { space, type Tone } from "../../src/theme";

type Return = {
  id: string;
  orderId: string;
  orderNumber: number;
  name: string;
  gift: boolean;
  status: "requested" | "approved" | "refunded" | "credited" | "replaced" | "exchanged" | "declined";
  reason: string;
  note: string | null;
  items: { title: string; quantity: number; exchangeTitle: string | null }[];
  suggestedMinor: number;
  resolvedMinor: number | null;
  merchantMessage: string | null;
  currency: string;
  createdAt: string;
};

const STATUS: Record<Return["status"], { label: string; tone: Tone }> = {
  requested: { label: "Waiting for you", tone: "warning" },
  approved: { label: "Approved, coming back", tone: "info" },
  refunded: { label: "Refunded", tone: "success" },
  credited: { label: "Store credit given", tone: "success" },
  replaced: { label: "Replaced", tone: "success" },
  exchanged: { label: "Exchanged", tone: "success" },
  declined: { label: "Declined", tone: "neutral" },
};

/** Returns buyers asked for: answer them from the phone (approve, refund, store credit, replace, decline). */
export default function ReturnsScreen() {
  const [show, setShow] = useState<"open" | "all">("open");
  const list = useApi<{ open: number; returns: Return[] }>(`returns?show=${show}`);
  const [note, setNote] = useState<{ tone: Tone; text: string } | null>(null);
  const rows = list.data?.returns;
  return (
    <Screen title="Returns" back={<BackLink href="/" label="Today" />} onRefresh={list.reload} refreshing={list.loading && !!rows}>
      <Segmented
        label="Show"
        options={[
          ["open", `Open (${list.data?.open ?? 0})`],
          ["all", "All"],
        ]}
        value={show}
        onChange={(v) => setShow(v as "open" | "all")}
      />
      {note && <Banner tone={note.tone}>{note.text}</Banner>}
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!rows ? (
        list.loading ? <Loading /> : null
      ) : rows.length === 0 ? (
        <EmptyState heading={show === "open" ? "No returns to answer" : "No returns yet"} body="When a buyer asks to send something back, it shows here." />
      ) : (
        rows.map((r) => <ReturnCard key={r.id} r={r} done={(text, ok) => (setNote({ tone: ok ? "success" : "critical", text }), ok && list.reload())} />)
      )}
    </Screen>
  );
}

function ReturnCard({ r, done }: { r: Return; done: (text: string, ok: boolean) => void }) {
  const [amount, setAmount] = useState((r.suggestedMinor / 100).toFixed(2));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const open = r.status === "requested" || r.status === "approved";
  const exchange = r.items.some((i) => i.exchangeTitle);
  const label = `order #${r.orderNumber}`;

  async function decide(action: string) {
    const amountMinor = parseMoney(amount);
    if ((action === "refund" || action === "credit") && !amountMinor) return done("Enter the amount, like 12.50.", false);
    setBusy(action);
    try {
      const res = await send<{ message: string }>(`returns/${r.id}`, "POST", { action, amountMinor, message });
      done(res === "queued" ? "Saved. It's sent when you're back online." : res.message, true);
    } catch (e) {
      done((e as Error).message, false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
        <Heading>{`Order #${r.orderNumber} · ${r.name}`}</Heading>
        <Pill label={STATUS[r.status].label} tone={STATUS[r.status].tone} />
      </View>
      <Body>{r.reason}{r.note ? `: "${r.note}"` : ""}</Body>
      <Body muted>
        {r.items.map((i) => `${i.title} × ${i.quantity}${i.exchangeTitle ? `, wants ${i.exchangeTitle} instead` : ""}`).join("\n")}
        {`\nAsked ${when(r.createdAt)}${r.gift ? " by the person who got it as a gift" : ""}`}
        {r.resolvedMinor ? `\n${money(r.resolvedMinor, r.currency)} given back` : ""}
      </Body>
      {open ? (
        <>
          <Field label={`Amount for ${label}`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" hint={`What they paid for these: ${money(r.suggestedMinor, r.currency)}.`} />
          <Field label={`Message for ${label}`} value={message} onChangeText={setMessage} multiline placeholder="Optional, except when you decline" />
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            {r.status === "requested" ? <Button label="Approve" kind="secondary" a11y={`Approve the return on ${label}`} busy={busy === "approve"} onPress={() => decide("approve")} /> : null}
            {!r.gift ? <Button label="Refund" a11y={`Refund the return on ${label}`} busy={busy === "refund"} onPress={() => decide("refund")} /> : null}
            <Button label="Store credit" kind="secondary" a11y={`Give store credit for ${label}`} busy={busy === "credit"} onPress={() => decide("credit")} />
            {!r.gift && exchange ? <Button label="Send the exchange" kind="secondary" a11y={`Send the exchange for ${label}`} busy={busy === "exchange"} onPress={() => decide("exchange")} /> : null}
            {!r.gift && !exchange ? <Button label="Replace" kind="secondary" a11y={`Send a replacement for ${label}`} busy={busy === "replace"} onPress={() => decide("replace")} /> : null}
            <Button label="Decline" kind="danger" a11y={`Decline the return on ${label}`} busy={busy === "decline"} onPress={() => decide("decline")} />
          </View>
        </>
      ) : r.merchantMessage ? (
        <Body muted>{`You said: ${r.merchantMessage}`}</Body>
      ) : null}
    </Card>
  );
}
