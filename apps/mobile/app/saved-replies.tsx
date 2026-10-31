import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, LoadError, Loading, Screen, Section } from "../src/ui";
import { space } from "../src/theme";

type Reply = { id: string; title: string; body: string };
type Data = { replies: Reply[]; fields: { field: string; means: string }[]; max: number; startersMissing: number };
const EMPTY = { id: "", title: "", body: "" };

/**
 * The store's own answers to what buyers ask most. In a conversation, one tap puts a reply in the
 * box with the buyer's name, order number and tracking link filled in.
 */
export default function SavedRepliesScreen() {
  const data = useApi<Data>("saved-replies");
  const [form, setForm] = useState(EMPTY);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;

  async function run(key: string, path: string, init: { method?: string; body?: unknown }, after?: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, init);
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
    <Screen title="Saved replies" back={<BackLink href="/inbox" label="Inbox" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Start a reply from one of these in any conversation. Anything still in braces has to be filled in before the reply goes out.</Body>
          <Section title={form.id ? "Change the reply" : "New reply"}>
            <Card>
              <Field label="Name" value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} placeholder="Where is my order" />
              <Field label="Reply" value={form.body} onChangeText={(v) => setForm({ ...form, body: v })} multiline placeholder="Hi {first_name}, ..." hint={d.fields.map((f) => `${f.field} is ${f.means}`).join(". ") + "."} />
              <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                <Button
                  label={form.id ? "Save changes" : "Save reply"}
                  busy={busy === "save"}
                  disabled={!!busy || !form.title.trim() || !form.body.trim()}
                  onPress={() => run("save", "saved-replies", { body: form }, () => setForm(EMPTY))}
                />
                {form.id ? <Button label="Cancel" kind="ghost" onPress={() => setForm(EMPTY)} disabled={!!busy} /> : null}
              </View>
            </Card>
          </Section>
          <Section title={`Your replies (${d.replies.length} of ${d.max})`}>
            {d.replies.length === 0 ? <EmptyState heading="No saved replies yet" body="Start with the answers most stores need, then change them to sound like you." /> : null}
            {d.startersMissing > 0 ? (
              <Button label={d.replies.length ? "Add the missing starter replies" : "Add replies to start from"} kind="secondary" busy={busy === "starters"} disabled={!!busy} onPress={() => run("starters", "saved-replies/starters", { body: {} })} />
            ) : null}
            {d.replies.map((r) => (
              <Card key={r.id}>
                <View role="group" aria-label={r.title} style={{ gap: space(1) }}>
                  <Heading>{r.title}</Heading>
                  <Body muted>{r.body.length > 240 ? `${r.body.slice(0, 239)}…` : r.body}</Body>
                  <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                    <Button label="Change" kind="secondary" a11y={`Change ${r.title}`} disabled={!!busy} onPress={() => { setForm(r); setConfirm(null); }} />
                    {confirm === r.id ? (
                      <Button label={`Delete ${r.title}`} kind="danger" busy={busy === `del:${r.id}`} disabled={!!busy} onPress={() => run(`del:${r.id}`, `saved-replies/${r.id}`, { method: "DELETE" }, () => { setConfirm(null); if (form.id === r.id) setForm(EMPTY); })} />
                    ) : (
                      <Button label="Delete…" kind="ghost" a11y={`Delete ${r.title}…`} disabled={!!busy} onPress={() => setConfirm(r.id)} />
                    )}
                  </View>
                </View>
              </Card>
            ))}
          </Section>
        </>
      )}
    </Screen>
  );
}
