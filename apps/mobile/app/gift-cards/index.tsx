import { useEffect, useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../../src/api";
import { money, parseMoney, when } from "../../src/format";
import { useSession } from "../../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, LoadError, Loading, Pill, Screen, Section, Stat } from "../../src/ui";
import { space, type Tone } from "../../src/theme";

type GiftCard = { id: string; last4: string; email: string | null; balanceMinor: number; initialMinor: number; status: "active" | "used" | "off" | "expired"; orderNumber: number | null; sent: boolean; createdAt: string; expiresAt: string | null };

const STATUS: Record<GiftCard["status"], { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "success" },
  used: { label: "Used up", tone: "neutral" },
  off: { label: "Turned off", tone: "warning" },
  expired: { label: "Expired", tone: "neutral" },
};

/** Gift cards: look one up when a buyer asks what's left, send one, or turn one off. */
export default function GiftCardsScreen() {
  const cur = useSession().me?.shop.currency ?? "USD";
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const list = useApi<{ outstandingMinor: number; cards: GiftCard[] }>(`gift-cards?q=${encodeURIComponent(q)}`);
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: Tone; text: string } | null>(null);

  async function run(key: string, path: string, payload: unknown) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { body: payload });
      setNote({ tone: "success", text: r.message });
      await list.reload();
      return true;
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function give() {
    const amountMinor = parseMoney(amount);
    if (!amountMinor) return setNote({ tone: "critical", text: "Enter the amount, like 25." });
    if (await run("give", "gift-cards", { email: email.trim(), amountMinor })) {
      setEmail("");
      setAmount("");
    }
  }

  const cards = list.data?.cards;
  return (
    <Screen title="Gift cards" back={<BackLink href="/" label="Today" />} onRefresh={list.reload} refreshing={list.loading && !!cards}>
      {note && <Banner tone={note.tone}>{note.text}</Banner>}
      {list.data ? <Stat label="Unspent on gift cards" value={money(list.data.outstandingMinor, cur)} /> : null}
      <Field label="Find a gift card" value={query} onChangeText={setQuery} placeholder="Code, last 4, email or order #" autoCapitalize="none" hint="When a buyer asks what's left, type the code they read out." />
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!cards ? (
        list.loading ? <Loading /> : null
      ) : cards.length === 0 ? (
        <EmptyState heading={q ? "No gift card matches" : "No gift cards yet"} body={q ? "A full code, the last 4 characters, the email it went to or the order number all work." : "Cards you send and cards buyers buy show up here."} />
      ) : (
        cards.map((c) => (
          <Card key={c.id}>
            <View style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
              <Heading>{`···· ${c.last4}`}</Heading>
              <Pill label={STATUS[c.status].label} tone={STATUS[c.status].tone} />
            </View>
            <Body>{`${money(c.balanceMinor, cur)} left of ${money(c.initialMinor, cur)}`}</Body>
            <Body muted>
              {[c.email, c.orderNumber ? `bought on order #${c.orderNumber}` : "given by you", when(c.createdAt), c.expiresAt ? `expires ${when(c.expiresAt)}` : null, c.sent ? null : "email not sent"].filter(Boolean).join(" · ")}
            </Body>
            <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
              {c.status === "off" ? (
                <Button label="Turn on" kind="secondary" a11y={`Turn on the card ending ${c.last4}`} busy={busy === `on-${c.id}`} onPress={() => run(`on-${c.id}`, `gift-cards/${c.id}`, { action: "on" })} />
              ) : (
                <>
                  {c.email && c.balanceMinor > 0 ? (
                    <Button label="Send a new code" kind="secondary" a11y={`Send a new code for the card ending ${c.last4}`} busy={busy === `resend-${c.id}`} onPress={() => run(`resend-${c.id}`, `gift-cards/${c.id}`, { action: "resend" })} />
                  ) : null}
                  <Button label="Turn off" kind="danger" a11y={`Turn off the card ending ${c.last4}`} busy={busy === `off-${c.id}`} onPress={() => run(`off-${c.id}`, `gift-cards/${c.id}`, { action: "off" })} />
                </>
              )}
            </View>
          </Card>
        ))
      )}
      <Section title="Send a gift card">
        <Card>
          <Body muted>For a thank-you, a giveaway or store credit instead of a refund. The code is emailed to them.</Body>
          <Field label="Their email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <Field label="Gift card amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="25.00" />
          <Button label="Send gift card" busy={busy === "give"} disabled={!email.trim() || !amount.trim()} onPress={give} />
        </Card>
      </Section>
    </Screen>
  );
}
