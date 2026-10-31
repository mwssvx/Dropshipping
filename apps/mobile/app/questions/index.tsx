import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../../src/api";
import { when } from "../../src/format";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, LoadError, Loading, Pill, Screen, Segmented, Toggle } from "../../src/ui";
import { space } from "../../src/theme";

type Question = {
  id: string;
  productTitle: string;
  name: string;
  email: string;
  body: string;
  status: "waiting" | "published" | "private";
  answer: string | null;
  draft: string | null;
  createdAt: string;
  answeredAt: string | null;
};
type Show = "waiting" | "all";

const STATUS = { waiting: ["Waiting for you", "warning"], published: ["On the product page", "success"], private: ["Answered by email", "neutral"] } as const;

/** Shoppers' questions from product pages: answer them by email, and on the page for everyone. */
export default function QuestionsScreen() {
  const [show, setShow] = useState<Show>("waiting");
  const list = useApi<{ waiting: number; questions: Question[] }>(`questions?show=${show}`);
  const rows = list.data?.questions;
  const waiting = list.data?.waiting;
  return (
    <Screen title="Questions" back={<BackLink href="/" label="Today" />} onRefresh={list.reload} refreshing={list.loading && !!rows}>
      <Segmented
        label="Which questions"
        value={show}
        onChange={setShow}
        options={[
          ["waiting", waiting ? `To answer (${waiting})` : "To answer"],
          ["all", "All"],
        ]}
      />
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!rows ? (
        list.loading ? <Loading /> : null
      ) : rows.length === 0 ? (
        <EmptyState
          heading={show === "waiting" ? "No questions to answer" : "No questions yet"}
          body="Shoppers can ask about a product on its page. Their questions wait here, and the answer goes to them by email."
        />
      ) : (
        rows.map((q) => <QuestionCard key={q.id} question={q} onChange={list.reload} />)
      )}
    </Screen>
  );
}

function QuestionCard({ question: q, onChange }: { question: Question; onChange: () => Promise<unknown> }) {
  const [answer, setAnswer] = useState(q.answer ?? q.draft ?? "");
  const [publish, setPublish] = useState(q.status !== "private");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  async function run(key: string, change: { action: "answer" | "publish" | "hide"; answer?: string; publish?: boolean }) {
    setBusy(key);
    setNote(null);
    try {
      const res = await api<{ message: string }>(`questions/${q.id}`, { body: change });
      setNote({ tone: "success", text: res.message });
      setEditing(false);
      await onChange();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  const [label, tone] = STATUS[q.status];
  const answering = q.status === "waiting" || editing;
  return (
    <Card>
      <View role="article" aria-label={`${q.name}'s question about ${q.productTitle}`} style={{ gap: space(2) }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
          <Heading>{q.productTitle}</Heading>
          <Pill label={label} tone={tone} />
        </View>
        <Body>{q.body}</Body>
        <Body muted>{`${q.name} · ${q.email} · ${when(q.createdAt)}`}</Body>
        {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
        {answering ? (
          <>
            <Field label={`Answer to ${q.name}`} value={answer} onChangeText={setAnswer} multiline hint={q.draft && !q.answer ? "A suggested answer to start from. Change anything." : undefined} />
            <Toggle label="Show it on the product page" value={publish} onChange={setPublish} />
            <Button label={q.status === "waiting" ? "Send answer" : "Save answer"} busy={busy === "answer"} disabled={!!busy || answer.trim().length < 2} onPress={() => run("answer", { action: "answer", answer, publish })} />
            {editing ? <Button label="Cancel" kind="ghost" onPress={() => setEditing(false)} /> : null}
          </>
        ) : (
          <>
            <Body>{`Your answer: ${q.answer}`}</Body>
            <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
              <Button label="Change answer" kind="secondary" onPress={() => setEditing(true)} disabled={!!busy} />
              {q.status === "published" ? (
                <Button label="Take off the page" kind="ghost" busy={busy === "hide"} disabled={!!busy} onPress={() => run("hide", { action: "hide" })} />
              ) : (
                <Button label="Show on the page" kind="ghost" busy={busy === "publish"} disabled={!!busy} onPress={() => run("publish", { action: "publish" })} />
              )}
            </View>
          </>
        )}
      </View>
    </Card>
  );
}
