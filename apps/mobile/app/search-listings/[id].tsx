import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { api, useApi } from "../../src/api";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen, Section } from "../../src/ui";

type Data = { title: string; description: string; fallback: { title: string; description: string }; url: string; max: { title: number; description: number } };

/** One product's search title and snippet, with how the result would look. */
export default function SearchListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useApi<Data>(`products/${id}/seo`);
  const [edit, setEdit] = useState<{ title: string; description: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const f = edit ?? (d ? { title: d.title, description: d.description } : null);

  async function save() {
    if (!f) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>(`products/${id}/seo`, { method: "PUT", body: f });
      setNote({ tone: "success", text: r.message });
      setEdit(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const shownTitle = f && d ? f.title.trim() || d.fallback.title : "";
  const shownDescription = f && d ? f.description.trim() || d.fallback.description : "";
  return (
    <Screen title="Search listing" back={<BackLink href="/search-listings" label="Search listings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !f ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Search result preview">
            <Card>
              <Body muted>{d.url}</Body>
              <Body>{shownTitle.length > d.max.title ? `${shownTitle.slice(0, d.max.title - 3)}...` : shownTitle}</Body>
              <Body muted>{shownDescription || "Search engines will pick some text from the page."}</Body>
            </Card>
          </Section>
          <Card>
            <Body muted>Write it for someone searching: what it is, and why to click.</Body>
            <Field
              label="Headline in search results"
              value={f.title}
              onChangeText={(v) => setEdit({ ...f, title: v })}
              placeholder={d.fallback.title}
              hint={`${f.title.length} of ${d.max.title} characters. Leave it empty to use the product title.`}
            />
            <Field
              label="Snippet in search results"
              value={f.description}
              onChangeText={(v) => setEdit({ ...f, description: v })}
              multiline
              placeholder={d.fallback.description}
              hint={`${f.description.length} of ${d.max.description} characters. Leave it empty to use the start of the description.`}
            />
            <Button label="Save search listing" busy={busy} disabled={busy || !edit} onPress={save} />
          </Card>
        </>
      )}
    </Screen>
  );
}
