import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { api, useApi } from "../../src/api";
import { money, when } from "../../src/format";
import { setPendingCount, usePendingCount } from "../../src/badge";
import { useSession } from "../../src/session";
import { Banner, Body, Button, Card, Field, LoadError, Loading, Screen } from "../../src/ui";
import { color, radius, space } from "../../src/theme";

type Chat = {
  messages: { id: string; author: "merchant" | "agent" | "staff"; body: string; createdAt: string }[];
  budget: { limitMinor: number; spentMinor: number; left: boolean; resetsOn: string };
  demo: boolean;
};

const SUGGESTIONS = ["How am I doing this month?", "What are shoppers searching for?", "Are any orders stuck?", "Which products make the least?"];
const AUTHOR = { merchant: "You", agent: "Assistant", staff: "Support team" } as const;

export default function AssistantScreen() {
  const router = useRouter();
  const cur = useSession().me?.shop.currency ?? "USD";
  const chat = useApi<Chat>("assistant");
  const waiting = usePendingCount();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = chat.data;

  async function ask(message: string) {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("assistant", { body: { message } });
      setText("");
      await chat.reload();
      // The answer may have queued a change for approval.
      setPendingCount((await api<{ pending: unknown[] }>("today")).pending.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Assistant" onRefresh={chat.reload} refreshing={chat.loading && !!c}>
      <LoadError error={chat.error} stale={chat.stale} retry={chat.reload} />
      {!c ? (
        chat.loading ? <Loading /> : null
      ) : (
        <>
          {c.demo ? <Banner tone="info">Demo mode: a built-in stand-in answers until an Anthropic API key is added. It uses the same data and approval rules.</Banner> : null}
          {waiting > 0 ? <Button label={`${waiting} ${waiting === 1 ? "change waits" : "changes wait"} for your OK`} kind="secondary" onPress={() => router.push("/")} /> : null}
          <View style={{ gap: space(3) }} role="log" aria-label="Chat with your assistant">
            {c.messages.length === 0 ? (
              <Card>
                <Body>Ask me anything about your store: sales, orders, products and margins. Anything that changes your store or emails a customer waits for your OK on Today.</Body>
              </Card>
            ) : null}
            {c.messages.map((m) => {
              const mine = m.author === "merchant";
              return (
                <View key={m.id} style={{ alignItems: mine ? "flex-end" : "flex-start", gap: 2 }}>
                  <Text style={{ fontSize: 12, color: color.muted }}>
                    {AUTHOR[m.author]} · {when(m.createdAt)}
                  </Text>
                  <Text
                    style={{
                      maxWidth: "85%",
                      padding: space(3),
                      borderRadius: radius.lg,
                      overflow: "hidden",
                      fontSize: 15,
                      lineHeight: 21,
                      backgroundColor: mine ? color.accent : m.author === "staff" ? color.infoSoft : color.surface,
                      color: mine ? "#fff" : color.ink,
                      borderWidth: mine ? 0 : 1,
                      borderColor: color.border,
                    }}
                  >
                    {m.body}
                  </Text>
                </View>
              );
            })}
          </View>
          {error ? <Banner tone="critical">{error}</Banner> : null}
          <Card>
            <Field label="Message the assistant" value={text} onChangeText={setText} multiline placeholder="Ask about orders, products, money, or say what to change…" />
            <Button label="Send" onPress={() => ask(text)} busy={busy} disabled={!text.trim() || !c.budget.left} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
              {SUGGESTIONS.map((q) => (
                <Button key={q} label={q} kind="secondary" onPress={() => ask(q)} disabled={busy || !c.budget.left} />
              ))}
            </View>
          </Card>
          <Body muted>
            AI this month: {money(c.budget.spentMinor, cur)} of {money(c.budget.limitMinor, cur)}
            {c.budget.left ? "" : ". The budget is used up until it resets"}.
          </Body>
        </>
      )}
    </Screen>
  );
}
