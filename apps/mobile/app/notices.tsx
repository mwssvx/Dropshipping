import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, Heading, List, LoadError, Loading, Pill, Row, Screen, Section } from "../src/ui";
import { space } from "../src/theme";

type Kind = "warning" | "paused" | "reinstated";
type Notice = {
  id: string;
  kind: Kind;
  title: string;
  explanation: string;
  whatToDo: string;
  dueBy: string | null;
  createdAt: string;
  automatic: boolean;
  appeals: { id: string; message: string; status: "open" | "accepted" | "rejected"; response: string | null }[];
  canAppeal: boolean;
};
type Data = {
  paused: boolean;
  open: Notice[];
  history: { id: string; kind: Kind; title: string; createdAt: string }[];
  verifiedSince: string | null;
  checklist: { key: string; label: string; met: boolean; detail: string }[];
};

const KIND: Record<Kind, [string, "warning" | "critical" | "success"]> = { warning: ["Warning", "warning"], paused: ["Store paused", "critical"], reinstated: ["Reopened", "success"] };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * The store's standing with us. A warning always comes first, with the reason, what to do and a
 * deadline, before a store is ever paused, and every notice can be appealed to a person from here.
 */
export default function NoticesScreen() {
  const data = useApi<Data>("trust");
  const [appeal, setAppeal] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;

  async function run(key: string, path: string, init: { body?: unknown }, after?: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { method: "POST", ...init });
      setNote({ tone: "success", text: r.message });
      after?.();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Trust" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Your store's standing">
            <Card>
              <Body>
                {d.paused
                  ? "Your store is paused. Buyers can browse but can't order until it's reopened."
                  : d.open.length
                    ? "Your store is open, but there's something to fix below."
                    : "All good. Nothing needs your attention."}
              </Body>
              <Body muted>Our promise: we warn you first, with the reason and a deadline, before we ever pause a store. The only exceptions are illegal products and failed identity checks. Every decision can be appealed to a person.</Body>
            </Card>
          </Section>
          {d.open.map((n) => (
            <Section key={n.id} title={n.title}>
              <Card>
                <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                  <Pill label={KIND[n.kind][0]} tone={KIND[n.kind][1]} />
                  {n.dueBy ? <Pill label={`Fix by ${day(n.dueBy)}`} tone="warning" /> : null}
                </View>
                <Body>{`What happened: ${n.explanation}`}</Body>
                <Body>{`What to do: ${n.whatToDo}`}</Body>
                <Body muted>{`Sent ${day(n.createdAt)}${n.automatic ? " by our daily check" : ""}.`}</Body>
                {n.appeals.map((a) => (
                  <View key={a.id} style={{ gap: space(1) }}>
                    <Body>{`Your appeal: ${a.message}`}</Body>
                    {a.status === "open" ? (
                      <Body muted>Waiting for a reply. A person reads every appeal and replies here, usually within two working days.</Body>
                    ) : (
                      <Body>{`${a.status === "accepted" ? "Accepted" : "Not accepted"}: ${a.response ?? ""}`}</Body>
                    )}
                  </View>
                ))}
                {n.canAppeal ? (
                  <>
                    <Field
                      label="What you changed, or why this is wrong"
                      value={appeal[n.id] ?? ""}
                      onChangeText={(v) => setAppeal({ ...appeal, [n.id]: v })}
                      multiline
                      placeholder="I refunded the late orders and moved those items to a faster supplier."
                    />
                    <Button
                      label={n.kind === "paused" ? "Send appeal" : "Send reply"}
                      busy={busy === n.id}
                      disabled={!!busy || !(appeal[n.id] ?? "").trim()}
                      onPress={() => run(n.id, `trust/${n.id}/appeal`, { body: { message: appeal[n.id] } }, () => setAppeal({ ...appeal, [n.id]: "" }))}
                    />
                  </>
                ) : null}
              </Card>
            </Section>
          ))}
          <Section title="Verified store badge">
            <Card>
              <Pill label={d.verifiedSince ? `Verified since ${day(d.verifiedSince)}` : "Not yet"} tone={d.verifiedSince ? "success" : "neutral"} />
              <Body muted>The badge shows in your store's footer and links to a public page listing these rules, so buyers know what it means. We check every day.</Body>
              <View role="list" aria-label="Badge rules" style={{ gap: space(1) }}>
                {d.checklist.map((i) => (
                  <View key={i.key} role="listitem" aria-label={`${i.label}: ${i.met ? "met" : "not yet"}, ${i.detail}`} style={{ gap: 2 }}>
                    <Heading>{`${i.met ? "✓" : "○"} ${i.label}`}</Heading>
                    <Body muted>{i.detail}</Body>
                    {i.key === "returns" && !i.met ? <Row href="/pages" title="Add a returns page" /> : null}
                  </View>
                ))}
              </View>
              <Button label="Check now" kind="secondary" busy={busy === "check"} disabled={!!busy} onPress={() => run("check", "trust/verified", {})} />
            </Card>
          </Section>
          {d.history.length ? (
            <Section title="History">
              <List>
                {d.history.map((n) => (
                  <Row key={n.id} title={n.title} subtitle={`${KIND[n.kind][0]} · ${day(n.createdAt)}`} />
                ))}
              </List>
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}
