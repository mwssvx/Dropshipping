import { useRef, useState } from "react";
import { Animated, PanResponder, Platform, Text, View } from "react-native";
import { send } from "./api";
import { Banner, Body, Button, Card, Field, Pill } from "./ui";
import { color, space } from "./theme";

export const AGENT_LABEL: Record<string, string> = {
  listing: "Listing writer",
  assistant: "Assistant",
  buyer_support: "Buyer support",
  fulfilment: "Order fixer",
  margin: "Margin watch",
  writer: "Blog writer",
  translator: "Translator",
  answerer: "Question answerer",
  sizer: "Size chart drafter",
  shopper: "Shopping assistant",
  summarizer: "Review summarizer",
  analyst: "Business analyst",
  scout: "Trend scout",
  watch: "Store watch",
};

export type Proposal = { id: string; agent: string; summary: string; reason: string | null; input: Record<string, unknown> };

/**
 * Something an agent wants to do. Swipe right to approve or left to turn it down, or use the
 * buttons. Drafted messages can be edited first. Decisions made offline are sent later.
 */
export function ProposalCard({ action, onDone }: { action: Proposal; onDone: (outcome: string) => void }) {
  const draft = typeof action.input.message === "string" ? (action.input.message as string) : null;
  const [message, setMessage] = useState(draft ?? "");
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const x = useRef(new Animated.Value(0)).current;

  async function decide(approve: boolean) {
    setBusy(approve ? "yes" : "no");
    setError(null);
    try {
      const label = `${approve ? (draft ? "Send" : "Approve") : "Turn down"}: ${action.summary}`;
      const r = await send(`actions/${action.id}`, "POST", { approve, ...(draft !== null && approve ? { message } : {}) }, label);
      onDone(r === "queued" ? "Saved. It's sent when you're back online." : approve ? (draft ? "Sent." : "Done.") : "Turned down. Nothing was changed.");
    } catch (e) {
      setError((e as Error).message);
      Animated.spring(x, { toValue: 0, useNativeDriver: Platform.OS !== "web" }).start();
    } finally {
      setBusy(null);
    }
  }

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: Animated.event([null, { dx: x }], { useNativeDriver: false }),
      onPanResponderRelease: (_, g) => {
        if (g.dx > 120) void decide(true);
        else if (g.dx < -120) void decide(false);
        else Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
      },
    }),
  ).current;

  const swipe = Platform.OS === "web" || draft !== null ? {} : pan.panHandlers;
  return (
    <Animated.View style={{ transform: [{ translateX: x }] }} {...swipe}>
      <Card>
        <View role="article" aria-label={action.summary} style={{ gap: space(2) }}>
          <Pill label={AGENT_LABEL[action.agent] ?? action.agent} tone="info" />
          <Text style={{ fontSize: 16, fontWeight: "600", color: color.ink }}>{action.summary}</Text>
          {action.reason ? <Body muted>Needs your OK: {action.reason.charAt(0).toLowerCase() + action.reason.slice(1)}</Body> : null}
          {draft !== null ? <Field label="Message to the buyer" value={message} onChangeText={setMessage} multiline /> : null}
          {error ? <Banner tone="critical">{error}</Banner> : null}
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            <Button label={draft !== null ? "Send" : "Approve"} onPress={() => decide(true)} busy={busy === "yes"} disabled={!!busy} />
            <Button label={draft !== null ? "Discard" : "Don't do it"} kind="secondary" onPress={() => decide(false)} busy={busy === "no"} disabled={!!busy} />
          </View>
          {Platform.OS !== "web" && draft === null ? <Body muted>Or swipe right to approve, left to turn it down.</Body> : null}
        </View>
      </Card>
    </Animated.View>
  );
}
