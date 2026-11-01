import { useRouter } from "expo-router";
import { useState } from "react";
import { api, useApi } from "../../src/api";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, List, LoadError, Loading, Pill, Row, Screen, Section, Toggle } from "../../src/ui";

type Data = { pages: { id: string; title: string; published: boolean; url: string }[]; policies: { kind: string; title: string; added: boolean }[] };

/**
 * The store's own pages, like About us or Contact, and the policy pages buyers, banks and ad
 * platforms look for. Policies are written from the store's settings and added with a tap.
 */
export default function PagesScreen() {
  const router = useRouter();
  const data = useApi<Data>("pages");
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const missing = d?.policies.filter((p) => !p.added) ?? [];
  const kinds = missing.filter((p) => picked[p.kind] ?? true).map((p) => p.kind);

  async function start() {
    setBusy("add");
    setNote(null);
    try {
      const r = await api<{ id: string }>("pages", { body: { title } });
      setTitle("");
      router.push(`/pages/${r.id}`);
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function addPolicies() {
    setBusy("policies");
    setNote(null);
    try {
      const r = await api<{ message: string }>("pages/policies", { body: { kinds } });
      setNote({ tone: "success", text: r.message });
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Pages" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Stores with clear shipping and return pages get more trust and fewer support questions. Add them to your footer menu in the theme editor on the website.</Body>
          <Section title="Your pages">
            {d.pages.length === 0 ? (
              <EmptyState heading="No pages yet" body="Add the policy pages below, or start one of your own." />
            ) : (
              <List>
                {d.pages.map((p) => (
                  <Row key={p.id} href={`/pages/${p.id}`} title={p.title} right={<Pill label={p.published ? "Visible" : "Hidden"} tone={p.published ? "success" : "neutral"} />} a11y={`${p.title}, ${p.published ? "visible" : "hidden"}`} />
                ))}
              </List>
            )}
          </Section>
          <Section title="Store policies">
            <Card>
              <Body muted>We write these from your settings: your return window, shipping rates and times, pickup and ad tracking. Add the ones you want, then edit them like any page. They're a starting point, not legal advice.</Body>
              {d.policies.map((p) =>
                p.added ? (
                  <Row key={p.kind} title={p.title} right={<Pill label="Added" tone="success" />} />
                ) : (
                  <Toggle key={p.kind} label={p.title} value={picked[p.kind] ?? true} onChange={(v) => setPicked({ ...picked, [p.kind]: v })} />
                ),
              )}
              {missing.length ? (
                <Button label="Add policy pages" busy={busy === "policies"} disabled={!!busy || !kinds.length} onPress={addPolicies} />
              ) : null}
            </Card>
          </Section>
          <Section title="New page">
            <Card>
              <Field label="Title" value={title} onChangeText={setTitle} placeholder="About us" />
              <Button label="Start a page" busy={busy === "add"} disabled={!!busy || !title.trim()} onPress={start} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
