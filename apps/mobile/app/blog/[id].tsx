import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Share, View } from "react-native";
import { api, useApi } from "../../src/api";
import { postState, type PostSummary } from "../../src/blog";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Pill, Screen, Section } from "../../src/ui";
import { space } from "../../src/theme";

type Post = PostSummary & { body: string; excerpt: string; tags: string; hasImage: boolean; productCount: number };
type Draft = { title: string; body: string; excerpt: string; tags: string };

/** "2026-11-27" and "09:00" on this phone's clock, as a moment. Empty when the day is. */
function moment(day: string, time: string) {
  if (!day.trim()) return "";
  const d = new Date(`${day.trim()}T${time.trim() || "00:00"}`);
  return Number.isNaN(d.getTime()) ? "invalid" : d.toISOString();
}

/**
 * One blog post: write it, then publish it now or at a time, take it back to a draft, share its
 * link or delete it. Unsaved writing is saved before it's published.
 */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useApi<{ post: Post; topicsMax: number }>(`blog/${id}`);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [when, setWhen] = useState({ day: "", time: "09:00" });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const p = data.data?.post;
  const t = edit ?? (p ? { title: p.title, body: p.body, excerpt: p.excerpt, tags: p.tags } : null);
  useEffect(() => setConfirm(false), [p]);

  async function run(key: string, steps: { path: string; method?: string; body?: unknown }[], after?: () => void, reload = true) {
    setBusy(key);
    setNote(null);
    try {
      let message = "";
      for (const s of steps) message = (await api<{ message: string }>(s.path, { method: s.method, body: s.body })).message;
      setNote({ tone: "success", text: message });
      after?.();
      if (reload) await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  // Publishing saves what's typed first, so the post goes up as it reads on screen.
  const save = edit ? [{ path: `blog/${id}`, method: "PUT", body: edit }] : [];
  const saved = () => setEdit(null);

  function schedule() {
    const at = moment(when.day, when.time);
    if (!at || at === "invalid") return setNote({ tone: "critical", text: "Enter the day as YYYY-MM-DD, and the time as 09:00." });
    void run("schedule", [...save, { path: `blog/${id}/publish`, method: "POST", body: { at } }], saved);
  }

  return (
    <Screen title="Blog post" back={<BackLink href="/blog" label="Blog" />} onRefresh={data.reload} refreshing={data.loading && !!p}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!p || !t ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
            <Pill label={postState(p)} tone={p.state === "live" ? "success" : p.state === "scheduled" ? "info" : "neutral"} />
            {p.hasImage || p.productCount ? <Body muted>{[p.hasImage ? "Has a photo" : "", p.productCount ? (p.productCount === 1 ? "Features 1 product" : `Features ${p.productCount} products`) : ""].filter(Boolean).join(" · ")}</Body> : null}
          </View>
          <Section title="Writing">
            <Card>
              <Field label="Title" value={t.title} onChangeText={(v) => setEdit({ ...t, title: v })} />
              <Field label="Post" value={t.body} onChangeText={(v) => setEdit({ ...t, body: v })} multiline placeholder="Write in plain text." hint="A blank line starts a new paragraph, a line starting with ## is a subheading, and lines starting with - make a list." />
              <Field label="Summary (optional)" value={t.excerpt} onChangeText={(v) => setEdit({ ...t, excerpt: v })} multiline hint="Shown on the blog page and in search results. Without one, the start of the post is used." />
              <Field label="Topics (optional)" value={t.tags} onChangeText={(v) => setEdit({ ...t, tags: v })} placeholder="Lighting, Gift ideas" hint={`Up to ${data.data!.topicsMax}, with commas between.`} />
              <Button label="Save" busy={busy === "save"} disabled={!!busy || !edit} onPress={() => run("save", save, saved)} />
            </Card>
          </Section>
          <Section title="On your store">
            <Card>
              {p.state === "live" ? (
                <>
                  <Body>Buyers can read it on your blog.</Body>
                  <Button label="Share" kind="secondary" a11y="Share the post" onPress={() => void Share.share({ message: `${p.title}: ${p.url}`, url: p.url })} />
                  <Button label="Unpublish" kind="secondary" busy={busy === "off"} disabled={!!busy} onPress={() => run("off", [{ path: `blog/${id}/unpublish`, method: "POST" }])} />
                </>
              ) : (
                <>
                  <Body>{p.state === "scheduled" ? "It goes up by itself at that time. Publish it now instead, or change the time." : "Only you can see it until it's published."}</Body>
                  <Button label="Publish now" busy={busy === "publish"} disabled={!!busy} onPress={() => run("publish", [...save, { path: `blog/${id}/publish`, method: "POST" }], saved)} />
                  <Field label="Publish on" value={when.day} onChangeText={(v) => setWhen({ ...when, day: v })} placeholder="YYYY-MM-DD" autoCapitalize="none" keyboardType="numbers-and-punctuation" />
                  <Field label="At" value={when.time} onChangeText={(v) => setWhen({ ...when, time: v })} placeholder="09:00" autoCapitalize="none" keyboardType="numbers-and-punctuation" />
                  <Button label={p.state === "scheduled" ? "Change the time" : "Schedule"} kind="secondary" busy={busy === "schedule"} disabled={!!busy || !when.day.trim()} onPress={schedule} />
                  {p.state === "scheduled" ? <Button label="Unschedule" kind="ghost" busy={busy === "off"} disabled={!!busy} onPress={() => run("off", [{ path: `blog/${id}/unpublish`, method: "POST" }])} /> : null}
                </>
              )}
            </Card>
          </Section>
          <Section title="Delete">
            <Card>
              {confirm ? (
                <Button
                  label="Delete this post"
                  kind="danger"
                  busy={busy === "delete"}
                  disabled={!!busy}
                  onPress={() => run("delete", [{ path: `blog/${id}`, method: "DELETE" }], () => router.replace("/blog"), false)}
                />
              ) : (
                <Button label="Delete…" kind="ghost" a11y="Delete this post…" disabled={!!busy} onPress={() => setConfirm(true)} />
              )}
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
