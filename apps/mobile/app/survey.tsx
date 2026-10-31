import { useState } from "react";
import { Text } from "react-native";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, List, LoadError, Loading, Row, Screen, Section, Segmented, Toggle } from "../src/ui";
import { color } from "../src/theme";

type Survey = { question: string; options: string[]; other: boolean };
type Data = {
  survey: Survey | null;
  days: number;
  orders: number;
  answered: number;
  rows: { answer: string; orders: number; share: number; revenueMinor: number }[];
  others: { number: number; text: string }[];
};
type Days = "30" | "90" | "365";

const STARTER: Survey = { question: "How did you hear about us?", options: ["Instagram", "TikTok", "Facebook", "Google search", "A friend or family member", "YouTube", "A podcast"], other: true };

/**
 * "How did you hear about us?", asked once on the order page after paying. Ads only count clicks,
 * so this is where word of mouth, podcasts and videos watched without clicking show up.
 */
export default function SurveyScreen() {
  const [days, setDays] = useState<Days>("30");
  const data = useApi<Data>(`survey?days=${days}`);
  const cur = useSession().me?.shop.currency ?? "USD";
  const [edit, setEdit] = useState<{ question: string; options: string; other: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;

  async function save(on: boolean) {
    setBusy(on ? "save" : "off");
    setNote(null);
    try {
      const body = on && edit ? { on, question: edit.question, options: edit.options.split("\n"), other: edit.other } : { on: false };
      const r = await api<{ message: string }>("survey", { method: "PUT", body });
      setNote({ tone: "success", text: r.message });
      setEdit(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  const startEditing = (s: Survey) => setEdit({ question: s.question, options: s.options.join("\n"), other: s.other });

  return (
    <Screen title="Buyer survey" back={<BackLink href="/analytics" label="Analytics" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Buyers are asked once, on their order page right after paying. Ads only count clicks, so this is where word of mouth and videos people watched show up.</Body>
          {edit ? (
            <Card>
              <Field label="Question" value={edit.question} onChangeText={(v) => setEdit({ ...edit, question: v })} />
              <Field label="Answers, one per line" value={edit.options} onChangeText={(v) => setEdit({ ...edit, options: v })} multiline hint="2 to 8 answers." />
              <Toggle label="Let buyers type their own answer" value={edit.other} onChange={(v) => setEdit({ ...edit, other: v })} />
              <Button label={d.survey ? "Save the question" : "Start asking"} busy={busy === "save"} disabled={!!busy} onPress={() => save(true)} />
              <Button label="Cancel" kind="ghost" onPress={() => setEdit(null)} />
            </Card>
          ) : d.survey ? (
            <Card>
              <Heading>{d.survey.question}</Heading>
              <Body muted>{`${d.survey.options.join(" · ")}${d.survey.other ? " · or their own words" : ""}`}</Body>
              <Button label="Change the question" kind="secondary" onPress={() => startEditing(d.survey!)} />
              <Button label="Stop asking" kind="ghost" busy={busy === "off"} disabled={!!busy} onPress={() => save(false)} />
            </Card>
          ) : (
            <Card>
              <Heading>Not asking yet</Heading>
              <Body muted>Start with the usual answers and change them to fit your store.</Body>
              <Button label="Set up the question" onPress={() => startEditing(STARTER)} />
            </Card>
          )}
          <Section title="What buyers said">
            <Segmented label="Period" value={days} onChange={setDays} options={[["30", "30 days"], ["90", "90 days"], ["365", "Last year"]]} />
            <Body muted>{`${d.answered} of ${d.orders === 1 ? "1 order" : `${d.orders} orders`} answered${d.orders ? ` (${Math.round((d.answered / d.orders) * 100)}%)` : ""}.`}</Body>
            {d.rows.length ? (
              <List>
                {d.rows.map((r) => (
                  <Row
                    key={r.answer}
                    title={r.answer}
                    subtitle={`${r.orders} ${r.orders === 1 ? "order" : "orders"} · ${Math.round(r.share * 100)}%`}
                    right={<Text style={{ color: color.ink }}>{money(r.revenueMinor, cur)}</Text>}
                  />
                ))}
              </List>
            ) : (
              <EmptyState heading="No answers yet" body="They show here as buyers answer." />
            )}
          </Section>
          {d.others.length ? (
            <Section title="In their own words">
              <List>
                {d.others.map((o) => (
                  <Row key={o.number} title={o.text} subtitle={`Order #${o.number}`} />
                ))}
              </List>
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}
