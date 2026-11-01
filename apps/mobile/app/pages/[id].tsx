import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Share } from "react-native";
import { api, useApi } from "../../src/api";
import { BackLink, Banner, Button, Card, Field, LoadError, Loading, Screen, Section, Toggle } from "../../src/ui";

type Page = { id: string; title: string; body: string; published: boolean; url: string };

/** One store page: its title and text, whether buyers can see it, its link, and deleting it. */
export default function PageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useApi<{ page: Page }>(`pages/${id}`);
  const [edit, setEdit] = useState<{ title: string; body: string; published: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const p = data.data?.page;
  const f = edit ?? (p ? { title: p.title, body: p.body, published: p.published } : null);
  useEffect(() => setConfirm(false), [p]);

  async function save() {
    setBusy("save");
    setNote(null);
    try {
      const r = await api<{ message: string }>(`pages/${id}`, { method: "PUT", body: f });
      setNote({ tone: "success", text: r.message });
      setEdit(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setNote(null);
    try {
      await api(`pages/${id}`, { method: "DELETE" });
      router.replace("/pages");
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
      setBusy(null);
    }
  }

  return (
    <Screen title="Page" back={<BackLink href="/pages" label="Pages" />} onRefresh={data.reload} refreshing={data.loading && !!p}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!p || !f ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Page">
            <Card>
              <Field label="Title" value={f.title} onChangeText={(v) => setEdit({ ...f, title: v })} />
              <Field label="Text" value={f.body} onChangeText={(v) => setEdit({ ...f, body: v })} multiline placeholder="Write in plain text." hint="A blank line starts a new paragraph." />
              <Toggle label="Visible on the store" value={f.published} onChange={(v) => setEdit({ ...f, published: v })} />
              <Button label="Save" busy={busy === "save"} disabled={!!busy || !edit} onPress={save} />
              {p.published ? <Button label="Share" kind="secondary" a11y="Share the page" onPress={() => void Share.share({ message: `${p.title}: ${p.url}`, url: p.url })} /> : null}
            </Card>
          </Section>
          <Section title="Delete">
            <Card>
              {confirm ? (
                <Button label="Delete this page" kind="danger" busy={busy === "delete"} disabled={!!busy} onPress={remove} />
              ) : (
                <Button label="Delete…" kind="ghost" a11y="Delete this page…" disabled={!!busy} onPress={() => setConfirm(true)} />
              )}
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
