import { useState } from "react";
import { api, useApi } from "../src/api";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, Field, List, LoadError, Loading, Row, Screen, Section, Toggle } from "../src/ui";

type Data = {
  pickup: { address: string; instructions: string | null } | null;
  delivery: { postalPrefixes: string[]; priceMinor: number; freeOverMinor: number | null; note: string | null } | null;
};
type Pickup = { on: boolean; address: string; instructions: string };
type Delivery = { on: boolean; postalPrefixes: string; price: string; freeOver: string; note: string };

const amount = (m: number | null | undefined) => (m ? (m / 100).toFixed(2) : "");

/** Local pickup and local delivery: buyers nearby collect their order, or the store brings it. */
export default function LocalScreen() {
  const cur = useSession().me?.shop.currency ?? "USD";
  const data = useApi<Data>("local");
  const [pickup, setPickup] = useState<Pickup | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const p = pickup ?? (d ? { on: !!d.pickup, address: d.pickup?.address ?? "", instructions: d.pickup?.instructions ?? "" } : null);
  const l =
    delivery ??
    (d ? { on: !!d.delivery, postalPrefixes: d.delivery?.postalPrefixes.join(", ") ?? "", price: amount(d.delivery?.priceMinor), freeOver: amount(d.delivery?.freeOverMinor), note: d.delivery?.note ?? "" } : null);

  async function run(key: string, path: string, body: unknown, after: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { method: "PUT", body });
      setNote({ tone: "success", text: r.message });
      after();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Pickup and local delivery" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !p || !l ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Local pickup">
            <Card>
              <Body muted>Buyers nearby can pick their order up for free. They're told where and how when they order, and you mark it ready from the order.</Body>
              <Toggle label="Offer local pickup" value={p.on} onChange={(v) => setPickup({ ...p, on: v })} />
              {p.on ? (
                <>
                  <Field label="Pickup address" value={p.address} onChangeText={(v) => setPickup({ ...p, address: v })} multiline placeholder="12 Main St, Austin, TX 78701" />
                  <Field label="How to collect (optional)" value={p.instructions} onChangeText={(v) => setPickup({ ...p, instructions: v })} multiline placeholder="Ring the bell at the side door, weekdays 9 to 5." />
                </>
              ) : null}
              <Button label="Save pickup" busy={busy === "pickup"} disabled={!!busy || !pickup} onPress={() => run("pickup", "local/pickup", p, () => setPickup(null))} />
            </Card>
          </Section>
          <Section title="Local delivery">
            <Card>
              <Body muted>Deliver orders yourself to the postal codes you list. Buyers there see it at checkout with your price.</Body>
              <Toggle label="Offer local delivery" value={l.on} onChange={(v) => setDelivery({ ...l, on: v })} />
              {l.on ? (
                <>
                  <Field label="Postal codes you deliver to" value={l.postalPrefixes} onChangeText={(v) => setDelivery({ ...l, postalPrefixes: v })} autoCapitalize="none" placeholder="787, 78613" hint="The start of each is enough: 787 covers every code that begins with it." />
                  <Field label={`Delivery price (${cur})`} value={l.price} onChangeText={(v) => setDelivery({ ...l, price: v })} keyboardType="decimal-pad" placeholder="5.00" hint="Empty or 0.00 for free." />
                  <Field label={`Free on orders over (${cur}, optional)`} value={l.freeOver} onChangeText={(v) => setDelivery({ ...l, freeOver: v })} keyboardType="decimal-pad" placeholder="50.00" />
                  <Field label="When it arrives (optional)" value={l.note} onChangeText={(v) => setDelivery({ ...l, note: v })} placeholder="We deliver on weekday evenings." />
                </>
              ) : null}
              <Button label="Save local delivery" busy={busy === "delivery"} disabled={!!busy || !delivery} onPress={() => run("delivery", "local/delivery", l, () => setDelivery(null))} />
            </Card>
          </Section>
          {d.pickup || d.delivery ? (
            <List>
              <Row href="/orders" title="Pickups and deliveries" subtitle="Mark orders ready, collected or delivered from the Orders tab" />
            </List>
          ) : null}
        </>
      )}
    </Screen>
  );
}
