import { useEffect, useState } from "react";
import { Share } from "react-native";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen, Section, Toggle } from "../src/ui";

type Question = { text: string; answers: { label: string; tag: string }[] };
type Data = { quiz: { title: string; intro: string | null; on: boolean; questions: Question[] } | null; tags: string[]; url: string; maxQuestions: number; maxAnswers: number };
type Edit = { title: string; intro: string; on: boolean; questions: { text: string; answers: string }[] };

/** "My kids: kids" per line, the answer then the product tag it leads to. */
const answersText = (q: Question) => q.answers.map((a) => `${a.label}: ${a.tag}`).join("\n");
function answers(text: string) {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const at = l.lastIndexOf(":");
      return at < 0 ? { label: l.trim(), tag: "" } : { label: l.slice(0, at).trim(), tag: l.slice(at + 1).trim() };
    });
}

/** The product quiz: a few questions whose answers each lead to a product tag; shoppers get the best matches. */
export default function QuizScreen() {
  const data = useApi<Data>("quiz");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  useEffect(() => setConfirm(false), [d]);
  const f: Edit | null =
    edit ??
    (d
      ? d.quiz
        ? { title: d.quiz.title, intro: d.quiz.intro ?? "", on: d.quiz.on, questions: d.quiz.questions.map((q) => ({ text: q.text, answers: answersText(q) })) }
        : { title: "", intro: "", on: true, questions: [{ text: "", answers: "" }] }
      : null);
  const setQuestion = (i: number, q: Partial<Edit["questions"][number]>) => f && setEdit({ ...f, questions: f.questions.map((x, k) => (k === i ? { ...x, ...q } : x)) });

  async function run(key: string, path: string, method: "PUT" | "DELETE", body?: unknown) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { method, body });
      setNote({ tone: "success", text: r.message });
      setEdit(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Product quiz" back={<BackLink href="/products" label="Products" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !f ? (
        data.loading ? <Loading /> : null
      ) : d.tags.length < 2 ? (
        <Banner tone="warning">{`Answers lead to product tags, and your products have ${d.tags.length ? "only one" : "none"} yet. Tag your products first, like "kids" or "bedroom".`}</Banner>
      ) : (
        <>
          <Body muted>A few questions that point shoppers to the right products. Each answer leads to one of your product tags. The picks are the products with the most of the tags a shopper chose, best sellers first, and never anything sold out.</Body>
          {d.quiz?.on ? (
            <Card>
              <Body>{d.url}</Body>
              <Button label="Share the quiz" kind="secondary" onPress={() => void Share.share({ message: `${d.quiz!.title}: ${d.url}`, url: d.url })} />
            </Card>
          ) : null}
          <Section title="Quiz">
            <Card>
              <Field label="Quiz title" value={f.title} onChangeText={(v) => setEdit({ ...f, title: v })} placeholder="Find your lamp" />
              <Field label="A line under the title (optional)" value={f.intro} onChangeText={(v) => setEdit({ ...f, intro: v })} placeholder="Three questions and we'll pick for you." />
              <Toggle label="Show the quiz on the store" value={f.on} onChange={(v) => setEdit({ ...f, on: v })} />
            </Card>
          </Section>
          {f.questions.map((q, i) => (
            <Section key={i} title={`Question ${i + 1}`}>
              <Card>
                <Field label={`Question ${i + 1}`} value={q.text} onChangeText={(v) => setQuestion(i, { text: v })} placeholder={i === 0 ? "Who's it for?" : "Another question"} />
                <Field
                  label={`Answers to question ${i + 1}`}
                  value={q.answers}
                  onChangeText={(v) => setQuestion(i, { answers: v })}
                  multiline
                  autoCapitalize="none"
                  placeholder={"My kids: kids\nMe: adults"}
                  hint={`One per line, then a colon and the product tag it leads to. Up to ${d.maxAnswers}. Your tags: ${d.tags.join(", ")}.`}
                />
              </Card>
            </Section>
          ))}
          {f.questions.length < d.maxQuestions ? <Button label="Add a question" kind="secondary" onPress={() => setEdit({ ...f, questions: [...f.questions, { text: "", answers: "" }] })} /> : null}
          <Button
            label="Save the quiz"
            busy={busy === "save"}
            disabled={!!busy || !edit}
            onPress={() => void run("save", "quiz", "PUT", { title: f.title, intro: f.intro, on: f.on, questions: f.questions.map((q) => ({ text: q.text, answers: answers(q.answers) })) })}
          />
          {d.quiz ? (
            confirm ? (
              <Button label="Remove the quiz now" kind="danger" busy={busy === "remove"} disabled={!!busy} onPress={() => void run("remove", "quiz", "DELETE")} />
            ) : (
              <Button label="Remove the quiz…" kind="ghost" disabled={!!busy} onPress={() => setConfirm(true)} />
            )
          ) : null}
        </>
      )}
    </Screen>
  );
}
