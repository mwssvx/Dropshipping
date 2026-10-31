import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, List, LoadError, Loading, Row, Screen, Section } from "../src/ui";
import { space } from "../src/theme";

type Variant = { id: string; title: string; priceMinor: number; stock: number | null };
type Setup = { variants: Variant[]; countries: [string, string][]; defaultCountry: string };

/**
 * An order for a buyer who asked by message, phone or in person. We email them a link to pay by
 * card, with the same prices, shipping and tax as checkout; once paid it's an ordinary order.
 */
export default function PaymentLinkScreen() {
  const router = useRouter();
  const cur = useSession().me?.shop.currency ?? "USD";
  const setup = useApi<Setup>("payment-links/new");
  const [lines, setLines] = useState<{ variant: Variant; quantity: number }[]>([]);
  const [find, setFind] = useState("");
  const [form, setForm] = useState({ email: "", name: "", line1: "", line2: "", city: "", region: "", postalCode: "", phone: "", discountCode: "", note: "" });
  const [country, setCountry] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });

  const d = setup.data;
  const back = <BackLink href="/orders" label="Orders" />;
  if (!d) return <Screen title="Payment link" back={back}>{setup.loading ? <Loading /> : <LoadError error={setup.error} stale={false} retry={setup.reload} />}</Screen>;
  const where = country ?? d.defaultCountry;
  const term = find.trim().toLowerCase();
  const matches = term ? d.variants.filter((v) => v.title.toLowerCase().includes(term) && !lines.some((l) => l.variant.id === v.id)).slice(0, 6) : [];
  const itemsMinor = lines.reduce((sum, l) => sum + l.variant.priceMinor * l.quantity, 0);
  const qty = (id: string, by: number) => setLines(lines.flatMap((l) => (l.variant.id !== id ? [l] : l.quantity + by > 0 ? [{ ...l, quantity: Math.min(99, l.quantity + by) }] : [])));

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ orderId: string; message: string }>("payment-links", { body: { ...form, country: where, lines: lines.map((l) => ({ variantId: l.variant.id, quantity: l.quantity })) } });
      router.replace(`/orders/${r.orderId}?made=${encodeURIComponent(r.message)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (d.variants.length === 0) {
    return (
      <Screen title="Payment link" back={back}>
        <EmptyState heading="Nothing to sell yet" body="Put a product on sale first, then come back to make a payment link." />
      </Screen>
    );
  }

  return (
    <Screen title="Payment link" back={back}>
      <Body muted>For a buyer who asked by message, phone or in person. We email them a link to pay by card. Shipping and tax are worked out as at checkout.</Body>
      {error ? <Banner tone="critical">{error}</Banner> : null}

      <Section title="What they're buying">
        {lines.length ? (
          <List>
            {lines.map((l) => (
              <View key={l.variant.id} role="group" aria-label={l.variant.title} style={{ gap: space(1), padding: space(3) }}>
                <Body>{`${l.variant.title} · ${money(l.variant.priceMinor, cur)}`}</Body>
                <View style={{ flexDirection: "row", gap: space(2), alignItems: "center" }}>
                  <Button label="−" kind="secondary" a11y={`One fewer ${l.variant.title}`} onPress={() => qty(l.variant.id, -1)} />
                  <Body>{`${l.quantity}`}</Body>
                  <Button label="+" kind="secondary" a11y={`One more ${l.variant.title}`} onPress={() => qty(l.variant.id, 1)} />
                </View>
              </View>
            ))}
          </List>
        ) : null}
        <Field label="Add a product" value={find} onChangeText={setFind} placeholder="Type part of its name" autoCapitalize="none" />
        {matches.length ? (
          <List>
            {matches.map((v) => (
              <Row
                key={v.id}
                title={v.title}
                subtitle={`${money(v.priceMinor, cur)}${v.stock !== null ? ` · ${v.stock} in stock` : ""}`}
                a11y={`Add ${v.title}`}
                onPress={() => {
                  setLines([...lines, { variant: v, quantity: 1 }]);
                  setFind("");
                }}
              />
            ))}
          </List>
        ) : term ? (
          <Body muted>No product on sale matches.</Body>
        ) : null}
        <Field label="Discount code (optional)" value={form.discountCode} onChangeText={(v) => set("discountCode")(v.toUpperCase())} autoCapitalize="none" />
      </Section>

      <Section title="Who it's for">
        <Field label="Email" value={form.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Full name" value={form.name} onChangeText={set("name")} autoCapitalize="words" />
        <Field label="Address" value={form.line1} onChangeText={set("line1")} />
        <Field label="Apartment, suite (optional)" value={form.line2} onChangeText={set("line2")} />
        <Field label="City" value={form.city} onChangeText={set("city")} autoCapitalize="words" />
        <Field label="State or region" value={form.region} onChangeText={set("region")} />
        <Field label="Postal code" value={form.postalCode} onChangeText={set("postalCode")} autoCapitalize="none" />
        <Card>
          <Body>{`Country: ${d.countries.find(([c]) => c === where)?.[1] ?? where}`}</Body>
          {picking ? (
            <List>
              {d.countries.map(([c, name]) => (
                <Row key={c} title={name} a11y={`Ship to ${name}`} onPress={() => { setCountry(c); setPicking(false); }} />
              ))}
            </List>
          ) : d.countries.length > 1 ? (
            <Button label="Change country" kind="ghost" onPress={() => setPicking(true)} />
          ) : null}
        </Card>
        <Field label="Phone for the courier (optional)" value={form.phone} onChangeText={set("phone")} keyboardType="phone-pad" />
      </Section>

      <Section title="Note to them (optional)">
        <Field label="Note to the customer" value={form.note} onChangeText={set("note")} multiline placeholder="Thanks for your message! Here's the order we talked about." />
      </Section>

      <Card>
        <Heading>{lines.length ? `Items: ${money(itemsMinor, cur)}` : "Add a product to start"}</Heading>
        {lines.length ? <Body muted>Plus shipping and tax, shown to them before they pay.</Body> : null}
        <Button label="Email the payment link" busy={busy} disabled={!lines.length || !form.email.trim()} onPress={send} />
      </Card>
    </Screen>
  );
}
