import { useState } from "react";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { BackLink, Banner, Body, Button, Card, Field, List, LoadError, Loading, Row, Screen, Section, Toggle } from "../src/ui";

type Choice = { id: string; title: string };
type Data = {
  currency: string;
  thankYou: { note: string | null; max: number };
  afterCheckout: { offer: { productId: string; percentOff: number; active: boolean } | null; minutes: number; orders: number; revenueMinor: number };
  products: Choice[];
  subscribe: { offer: { percentOff: number; active: boolean } | null; withinDays: number; active: number; orders: number; salesMinor: number };
};

/** What buyers see once they've paid: a thank-you note, one more product for less, and subscribing to the same order. */
export default function AfterOrderScreen() {
  const data = useApi<Data>("after-order");
  const [thanks, setThanks] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ on: boolean; productId: string | null; percentOff: string } | null>(null);
  const [sub, setSub] = useState<{ on: boolean; percentOff: string } | null>(null);
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const t = thanks ?? d?.thankYou.note ?? "";
  const o = offer ?? (d ? { on: !!d.afterCheckout.offer?.active, productId: d.afterCheckout.offer?.productId ?? null, percentOff: String(d.afterCheckout.offer?.percentOff ?? 15) } : null);
  const s = sub ?? (d ? { on: !!d.subscribe.offer?.active, percentOff: String(d.subscribe.offer?.percentOff ?? 10) } : null);

  async function save(key: string, path: string, body: unknown, after: () => void) {
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

  const picked = d && o ? d.products.find((p) => p.id === o.productId) : undefined;
  const q = find.trim().toLowerCase();
  const shown = d ? (q ? d.products.filter((p) => p.title.toLowerCase().includes(q)) : d.products).slice(0, 5) : [];

  return (
    <Screen title="After the order" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !o || !s ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Thank-you note">
            <Card>
              <Body muted>A few words for buyers who just paid, on their order page and in the order confirmation email. Point them to your social pages, say how long handmade items take, or just thank them.</Body>
              <Field label="Thank-you note" value={t} onChangeText={setThanks} multiline hint={`Up to ${d.thankYou.max} characters. Leave it empty for no note.`} placeholder="Follow us on Instagram @yourstore for new arrivals." />
              <Button label="Save note" busy={busy === "thanks"} disabled={!!busy || thanks === null} onPress={() => void save("thanks", "after-order/thank-you", { note: t }, () => setThanks(null))} />
            </Card>
          </Section>

          <Section title="After-checkout offer">
            <Card>
              <Body muted>{`For ${d.afterCheckout.minutes} minutes after paying, the buyer's order page offers one more product for less. One tap adds it to the card they just used, with no shipping charge.`}</Body>
              <Toggle label="Offer one more product right after checkout" value={o.on} onChange={(v) => setOffer({ ...o, on: v })} />
              {o.on ? (
                <>
                  {picked ? (
                    <List>
                      <Row title={picked.title} subtitle="Tap to pick another" onPress={() => setOffer({ ...o, productId: null })} a11y={`Product to offer: ${picked.title}. Pick another`} />
                    </List>
                  ) : (
                    <>
                      <Field label="Product to offer" value={find} onChangeText={setFind} placeholder="Search your products" autoCapitalize="none" />
                      <List>
                        {shown.map((p) => (
                          <Row key={p.id} title={p.title} onPress={() => setOffer({ ...o, productId: p.id })} a11y={`Pick ${p.title}`} />
                        ))}
                      </List>
                    </>
                  )}
                  <Field label="Buyer saves (%)" value={o.percentOff} onChangeText={(v) => setOffer({ ...o, percentOff: v })} keyboardType="number-pad" />
                </>
              ) : null}
              <Button label="Save after-checkout offer" busy={busy === "offer"} disabled={!!busy || !offer} onPress={() => void save("offer", "after-order/offer", o, () => setOffer(null))} />
              <Body muted>{`Added ${d.afterCheckout.orders} ${d.afterCheckout.orders === 1 ? "time" : "times"} · ${money(d.afterCheckout.revenueMinor, d.currency)} in extra sales`}</Body>
            </Card>
          </Section>

          <Section title="Subscribe and save">
            <Card>
              <Body muted>{`For ${d.subscribe.withinDays} days after paying, the buyer's order page offers to send the same items again every 2 weeks, month or 2 months, for less. Buyers get an email before each charge and can skip, pause or cancel from a link.`}</Body>
              <Toggle label="Let buyers subscribe to their order" value={s.on} onChange={(v) => setSub({ ...s, on: v })} />
              {s.on ? <Field label="Subscriber saves (%)" value={s.percentOff} onChangeText={(v) => setSub({ ...s, percentOff: v })} keyboardType="number-pad" /> : null}
              <Button label="Save subscribe and save" busy={busy === "sub"} disabled={!!busy || !sub} onPress={() => void save("sub", "after-order/subscribe", s, () => setSub(null))} />
              <Body muted>{`${d.subscribe.active} active · ${d.subscribe.orders} repeat ${d.subscribe.orders === 1 ? "delivery" : "deliveries"} · ${money(d.subscribe.salesMinor, d.currency)} in repeat sales`}</Body>
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
