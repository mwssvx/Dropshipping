import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { api, useApi } from "../../src/api";
import { when } from "../../src/format";
import { ProposalCard, type Proposal } from "../../src/ProposalCard";
import { useCan } from "../../src/session";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Row, List, Screen, Section } from "../../src/ui";
import { color, radius, space } from "../../src/theme";

type Detail = {
  id: string;
  subject: string;
  status: string;
  statusReason: string | null;
  email: string | null;
  order: { id: string; number: number; name: string } | null;
  messages: { id: string; author: "buyer" | "merchant" | "agent" | "staff"; body: string; createdAt: string }[];
  pending: Proposal[];
  saved: { id: string; title: string; text: string; missing: string[] }[];
};

const WHO = { buyer: "Buyer", merchant: "You", agent: "Buyer support", staff: "Our trust team" } as const;

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const convo = useApi<Detail>(`inbox/${id}`);
  const can = useCan();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const c = convo.data;
  // Fields a saved reply couldn't fill, until they're taken out of the text.
  const [missing, setMissing] = useState<string[]>([]);
  const left = missing.filter((f) => text.includes(f));

  async function send() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>(`inbox/${id}/reply`, { body: { message: text } });
      setNote({ tone: "success", text: r.message });
      setText("");
      setMissing([]);
      await convo.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={c?.subject ?? "Conversation"} back={<BackLink href="/inbox" label="Inbox" />} onRefresh={convo.reload} refreshing={convo.loading && !!c}>
      <LoadError error={convo.error} stale={convo.stale} retry={convo.reload} />
      {!c ? (
        convo.loading ? <Loading /> : null
      ) : (
        <>
          {c.statusReason && c.status !== "resolved" ? (
            <Banner tone={c.status === "escalated" ? "critical" : "warning"}>
              {c.status === "escalated" ? "Sent to our trust team: " : "Handed to you: "}
              {c.statusReason}
            </Banner>
          ) : null}
          {c.order ? (
            <List>
              <Row title={`Order #${c.order.number}`} subtitle={c.order.name} href={`/orders/${c.order.id}` as never} />
            </List>
          ) : c.email ? (
            <Body muted>From your contact page: {c.email}. Your reply is emailed to them.</Body>
          ) : null}

          <View style={{ gap: space(3) }} role="log" aria-label="Messages">
            {c.messages.map((m) => {
              const theirs = m.author === "buyer";
              return (
                <View key={m.id} style={{ alignItems: theirs ? "flex-start" : "flex-end", gap: 2 }}>
                  <Text style={{ fontSize: 12, color: color.muted }}>
                    {WHO[m.author]} · {when(m.createdAt)}
                  </Text>
                  <Text
                    style={{
                      maxWidth: "85%",
                      padding: space(3),
                      borderRadius: radius.lg,
                      overflow: "hidden",
                      fontSize: 15,
                      lineHeight: 21,
                      backgroundColor: theirs ? color.surface : m.author === "staff" ? color.infoSoft : color.accent,
                      color: theirs || m.author === "staff" ? color.ink : "#fff",
                      borderWidth: theirs ? 1 : 0,
                      borderColor: color.border,
                    }}
                  >
                    {m.body}
                  </Text>
                </View>
              );
            })}
          </View>

          {done ? <Banner tone="success">{done}</Banner> : null}
          {can("assistant") && !done && c.pending.length > 0 ? (
            <Section title="Drafted reply">
              {c.pending.map((p) => (
                <ProposalCard
                  key={p.id}
                  action={p}
                  onDone={(outcome) => {
                    setDone(outcome);
                    void convo.reload();
                  }}
                />
              ))}
            </Section>
          ) : null}

          {c.email ? (
            <Card>
              {c.saved.length > 0 ? (
                <View style={{ gap: space(2) }}>
                  <Body muted>Start from a saved reply</Body>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                    {c.saved.map((r) => (
                      <Button
                        key={r.id}
                        label={r.title}
                        kind="secondary"
                        onPress={() => {
                          setText(r.text);
                          setMissing(r.missing);
                        }}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
              <Field label="Your reply" value={text} onChangeText={setText} multiline placeholder="Write to the buyer…" />
              {left.length ? <Banner tone="warning">{`Replace ${left.join(" and ")} before sending: this conversation has nothing to fill it with yet.`}</Banner> : null}
              {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
              <Button label="Send reply" onPress={send} busy={busy} disabled={text.trim().length < 2} />
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
