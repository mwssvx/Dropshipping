import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, Heading, LoadError, Loading, Pill, Screen, Section } from "../src/ui";
import { space } from "../src/theme";

type Ticket = { id: string; subject: string; status: string; dueAt: string | null; overdue: boolean; messages: { id: string; author: string; body: string; createdAt: string }[] };
type Data = { hours: number; tickets: Ticket[] };

const when = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const WHO: Record<string, string> = { merchant: "You", staff: "Our team", agent: "Assistant", buyer: "Buyer" };

/** Help from a person: write to our team, and see by when a person answers. */
export default function SupportScreen() {
  const data = useApi<Data>("support");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;

  async function send(key: string, path: string, body: unknown, after: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message?: string }>(path, { body });
      if (r.message) setNote({ tone: "success", text: r.message });
      after();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Help from a person" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body>{`A real person from our team answers within ${d.hours} hours, any day of the week. Not a bot. If we're late, you'll see it here.`}</Body>
          <Section title="Write to our team">
            <Card>
              <Field label="What it's about" value={subject} onChangeText={setSubject} placeholder="My payout hasn't arrived" />
              <Field label="What happened" value={message} onChangeText={setMessage} multiline hint="Add order numbers if you have them. Never send passwords or card numbers." />
              <Button
                label="Send to our team"
                busy={busy === "new"}
                disabled={!!busy || !subject.trim() || !message.trim()}
                onPress={() => send("new", "support", { subject, message }, () => { setSubject(""); setMessage(""); })}
              />
            </Card>
          </Section>
          {d.tickets.length ? (
            <Section title="Your requests">
              {d.tickets.map((t) => (
                <Card key={t.id}>
                  <Heading>{t.subject}</Heading>
                  <View style={{ flexDirection: "row" }}>
                    {t.status === "resolved" ? (
                      <Pill label="Answered" tone="success" />
                    ) : t.overdue ? (
                      <Pill label="Late, sorry. It's at the top of our list" tone="critical" />
                    ) : t.dueAt ? (
                      <Pill label={`A person answers by ${when.format(new Date(t.dueAt))}`} tone="info" />
                    ) : (
                      <Pill label="Our team replied" tone="success" />
                    )}
                  </View>
                  {t.messages.map((m) => (
                    <View key={m.id} style={{ gap: space(1) }}>
                      <Body muted>{`${WHO[m.author] ?? m.author} · ${when.format(new Date(m.createdAt))}`}</Body>
                      <Body>{m.body}</Body>
                    </View>
                  ))}
                  <Field label="Add to this request" value={replies[t.id] ?? ""} onChangeText={(v) => setReplies({ ...replies, [t.id]: v })} multiline />
                  <Button
                    label="Add"
                    kind="secondary"
                    busy={busy === t.id}
                    disabled={!!busy || !(replies[t.id] ?? "").trim()}
                    onPress={() => send(t.id, `support/${t.id}/reply`, { message: replies[t.id] }, () => setReplies({ ...replies, [t.id]: "" }))}
                  />
                </Card>
              ))}
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}
