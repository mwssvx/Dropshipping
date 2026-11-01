import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { api, useApi } from "../../src/api";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, LoadError, Loading, Screen, Section } from "../../src/ui";
import type { Tone } from "../../src/theme";

type Order = { id: string; number: number; name: string; paymentStatus: string; paidAt: string | null };

const LISTS: Record<string, string> = { late: "Late", open: "Open" };

/** One update, in the merchant's words, to the buyers of the orders on the Late or Open list. */
export default function EmailBuyersScreen() {
  const { show = "late" } = useLocalSearchParams<{ show?: string }>();
  const list = useApi<{ orders: Order[] }>(`orders?show=${show === "open" ? "open" : "late"}`);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: Tone; text: string } | null>(null);
  // Unpaid and refunded orders don't get it, as on the website.
  const gets = (list.data?.orders ?? []).filter((o) => o.paidAt && ["paid", "partially_refunded"].includes(o.paymentStatus)).sort((a, b) => a.number - b.number);

  async function send() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string; sent: number; failed: number }>("orders/email", { body: { ids: gets.map((o) => o.id), message } });
      setNote({ tone: r.sent && !r.failed ? "success" : "warning", text: r.message });
      if (r.sent) setMessage("");
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Email the buyers" back={<BackLink href={{ pathname: "/orders", params: { show: show === "open" ? "open" : "late" } }} label="Orders" />}>
      {note && <Banner tone={note.tone}>{note.text}</Banner>}
      <Body muted>Tell buyers what's going on in your own words: a supplier running late, a missing item on its way, or a week off. Each gets it by name, with a link to their order, and it shows on the order's timeline.</Body>
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!list.data ? (
        list.loading ? <Loading /> : null
      ) : gets.length === 0 ? (
        <EmptyState heading="No one to email" body={`None of the orders on the ${LISTS[show] ?? "Late"} list are paid.`} />
      ) : (
        <>
          <Section title={gets.length === 1 ? "1 buyer gets it" : `${gets.length} buyers get it`}>
            <Body muted>{gets.map((o) => `#${o.number} ${o.name}`).join(", ")}</Body>
          </Section>
          <Card>
            <Field
              label="Your update"
              value={message}
              onChangeText={setMessage}
              multiline
              autoCapitalize="sentences"
              placeholder="Our supplier is running a few days behind, so your order will ship by Friday instead of Wednesday. Sorry for the wait!"
              hint="It starts with Hi and their first name, and ends with a link to their order. Up to 1,000 characters."
            />
            <Button label={gets.length === 1 ? "Email 1 buyer" : `Email ${gets.length} buyers`} busy={busy} disabled={busy || !message.trim()} onPress={send} />
          </Card>
        </>
      )}
    </Screen>
  );
}
