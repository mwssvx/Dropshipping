import { useState } from "react";
import { Linking } from "react-native";
import { api, useApi } from "../src/api";
import { API_URL } from "../src/config";
import { useCan, useSession, type PushSettings } from "../src/session";
import { BackLink, Banner, Body, Button, Card, Field, List, Pill, Row, Screen, Section, Toggle } from "../src/ui";
import Constants from "expo-constants";

type StoreStatus = { mode: "open" | "password" | "holiday"; message: string | null; until: string | null };

const longDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** Open, or on a holiday break where buyers can look but not order, from the phone. */
function StoreStatusCard() {
  const status = useApi<StoreStatus>("store-status");
  const [until, setUntil] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const s = status.data;

  async function set(mode: "open" | "holiday") {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<StoreStatus & { said: string }>("store-status", { method: "PUT", body: { mode, until, message } });
      setNote({ tone: "success", text: r.said });
      setUntil("");
      setMessage("");
      await status.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;
  return (
    <Section title="Store status">
      <Card>
        {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
        <Pill label={s.mode === "open" ? "Open" : s.mode === "holiday" ? "On a break" : "Behind a password"} tone={s.mode === "open" ? "success" : "warning"} />
        {s.mode === "open" ? (
          <>
            <Body muted>Going away? Buyers can still look around but can't order, and every page says when you're back.</Body>
            <Field label="Back on" value={until} onChangeText={setUntil} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" hint="The store opens by itself that morning. Leave it empty to open it yourself." />
            <Field label="Message to buyers" value={message} onChangeText={setMessage} multiline placeholder="We're on holiday and back soon!" />
            <Button label="Take a break" kind="secondary" busy={busy} onPress={() => set("holiday")} />
          </>
        ) : (
          <>
            <Body>
              {s.mode === "holiday"
                ? `Buyers can look around but can't order${s.until ? `. It opens by itself on ${longDate(s.until)}` : " until you open it"}.`
                : "Only people with the password can see it. Change the password on the website."}
            </Body>
            {s.message ? <Body muted>{`"${s.message}"`}</Body> : null}
            <Button label={s.mode === "holiday" ? "Open the store now" : "Open to everyone"} busy={busy} onPress={() => set("open")} />
          </>
        )}
      </Card>
    </Section>
  );
}

export default function Settings() {
  const { me, switchShop, signOut, refreshMe } = useSession();
  const can = useCan();
  const [push, setPush] = useState<PushSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = push ?? me?.push ?? null;

  async function save(next: PushSettings) {
    setPush(next);
    setError(null);
    try {
      const off = [...next.kinds.filter((k) => !k.on).map((k) => k.kind), ...(next.newOrderSound ? [] : ["new_order_sound"])];
      setPush(await api<PushSettings>("me/push", { method: "PUT", body: { off } }));
      await refreshMe();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Screen title="Settings" back={<BackLink href="/" label="Today" />}>
      {error ? <Banner tone="critical">{error}</Banner> : null}
      {me && me.shops.length > 1 ? (
        <Section title="Store">
          <List>
            {me.shops.map((s) => (
              <Row key={s.id} title={s.name} onPress={() => switchShop(s.id)} right={s.id === me.shop.id ? <Pill label="Open" tone="success" /> : undefined} a11y={`Switch to ${s.name}`} />
            ))}
          </List>
        </Section>
      ) : null}
      {settings ? (
        <Section title="Notifications">
          <Card>
            {settings.kinds.map((k) => (
              <Toggle key={k.kind} label={k.label} value={k.on} onChange={(on) => save({ ...settings, kinds: settings.kinds.map((x) => (x.kind === k.kind ? { ...x, on } : x)) })} />
            ))}
            <Toggle label="Sound for new orders" value={settings.newOrderSound} onChange={(on) => save({ ...settings, newOrderSound: on })} />
          </Card>
        </Section>
      ) : null}
      {can("theme") ? <StoreStatusCard /> : null}
      {can("theme") ? (
        <Section title="Look">
          <List>
            <Row href="/store-look" title="Store look" subtitle="Publish your new look now, or have it go live and switch back by itself" />
          </List>
        </Section>
      ) : null}
      <Section title="Help">
        <List>
          <Row href="/support" title="Help from a person" subtitle="Write to our team. A real person answers, and you see by when" />
        </List>
      </Section>
      {can("trust") ? (
        <Section title="Trust">
          <List>
            <Row href="/notices" title="Your store's standing" subtitle="Warnings from us, appeals, and the verified store badge" />
          </List>
        </Section>
      ) : null}
      {can("pages") ? (
        <Section title="Blog and pages">
          <List>
            <Row href="/blog" title="Blog posts" subtitle="Write a post, then publish it now or at a time you pick" />
            <Row href="/pages" title="Pages" subtitle="About us, contact, and the shipping, returns and privacy policies" />
          </List>
        </Section>
      ) : null}
      {can("marketing") ? (
        <Section title="Sales channels">
          <List>
            <Row href="/channels" title="Google, Facebook, Pinterest and TikTok" subtitle="Feed links to list your products, and ad tracking" />
          </List>
        </Section>
      ) : null}
      {can("taxes") ? (
        <Section title="Taxes">
          <List>
            <Row href="/taxes" title="Taxes and duties" subtitle="Where you collect tax, your prices, import duties and what you owe" />
            <Row href="/invoices" title="Invoices" subtitle="Your details on invoices, and the ones issued so far" />
          </List>
        </Section>
      ) : null}
      {can("currencies") ? (
        <Section title="Selling abroad">
          <List>
            <Row href="/currencies" title="Currencies" subtitle="Prices, payment and refunds in the buyer's own currency" />
          </List>
        </Section>
      ) : null}
      {can("theme") ? (
        <Section title="Languages">
          <List>
            <Row href="/languages" title="Store languages" subtitle="Show your store in the languages of the countries you sell to" />
          </List>
        </Section>
      ) : null}
      {can("domains") ? (
        <Section title="Web addresses">
          <List>
            <Row href="/domains" title="Domains" subtitle="Connect a domain you own, like shop.example.com" />
            <Row href="/redirects" title="Redirects" subtitle="Old links that should still reach the right page" />
          </List>
        </Section>
      ) : null}
      {can("shipping") ? (
        <Section title="Shipping">
          <List>
            <Row href="/checkout-settings" title="Checkout" subtitle="The smallest order, asking for a phone number, and delivery protection" />
            <Row href="/shipping-zones" title="Shipping rates" subtitle="Zones of countries, what each rate costs and how long it takes" />
            <Row href="/local" title="Pickup and local delivery" subtitle="Buyers nearby collect their order, or you bring it" />
            <Row href="/delivery-dates" title="Delivery dates" subtitle="Say when orders arrive, on product pages, the cart and receipts" />
            <Row href="/ship-pause" title="Shipping pause" subtitle="Your supplier is closed for a while: keep selling, and say when orders ship" />
            <Row href="/holiday-date" title="Holiday order-by date" subtitle="“Order by Dec 15 to get it in time for Christmas” on product pages" />
            <Row href="/gift-wrap" title="Gift wrapping" subtitle="Buyers sending a gift can have it wrapped, for a price you set" />
            <Row href="/late-emails" title="Running late emails" subtitle="One friendly email when an order hasn't shipped, or a parcel is past its date" />
          </List>
        </Section>
      ) : null}
      {can("marketing") ? (
        <Section title="Checkout extras">
          <List>
            <Row href="/addons" title="Add-ons, free gift and tips" subtitle="One more product at checkout, a gift over an amount, and tips for you" />
            <Row href="/after-order" title="After the order" subtitle="A thank-you note, one more product for less, and subscribe and save" />
          </List>
        </Section>
      ) : null}
      {can("plan") ? (
        <Section title="Plan">
          <List>
            <Row href="/plan" title="Your plan" subtitle="What it cost you last month, and the plan that would cost least" />
          </List>
        </Section>
      ) : null}
      {can("team") ? (
        <Section title="Team">
          <List>
            <Row href="/team" title="People" subtitle="Invite someone, change what they can do, or remove them" />
            <Row href="/activity" title="Activity" subtitle="Who on your team did what: refunds, price changes, orders sent" />
          </List>
        </Section>
      ) : null}
      {can("developers") ? (
        <Section title="Developers">
          <List>
            <Row href="/developers" title="API keys and webhooks" subtitle="Revoke a key, pause or test a webhook, resend a failed delivery" />
          </List>
        </Section>
      ) : null}
      <Section title="Account">
        <List>
          {me ? <Row href="/account" title={me.user.email} subtitle="Two-step sign-in, Monday summary and where you're signed in" a11y="Your account" /> : null}
          <Row title="Open the web admin" right={<Pill label="↗" />} onPress={() => Linking.openURL(`${API_URL}/admin`)} />
          {me ? <Row title="View your store" right={<Pill label="↗" />} onPress={() => Linking.openURL(me.shop.address)} /> : null}
        </List>
        <Button label="Sign out" kind="secondary" onPress={signOut} />
        <Body muted>Version {Constants.expoConfig?.version ?? "1.0.0"}</Body>
      </Section>
    </Screen>
  );
}
