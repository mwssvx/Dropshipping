import { useRouter } from "expo-router";
import { useState } from "react";
import { api, useApi } from "../../src/api";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, List, LoadError, Loading, Row, Screen, Section } from "../../src/ui";
import { postState, type PostSummary } from "../../src/blog";

/**
 * The store's blog. Posts are listed with whether they're live, waiting for their time or a draft;
 * a new one starts here as a draft and opens to be written.
 */
export default function BlogScreen() {
  const router = useRouter();
  const data = useApi<{ posts: PostSummary[] }>("blog");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = data.data;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("blog", { body: { title } });
      setTitle("");
      router.push(`/blog/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Blog" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {error ? <Banner tone="critical">{error}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Posts about your products, how to use them or what's new bring shoppers from search. Add photos and featured products on the website.</Body>
          <Section title="New post">
            <Card>
              <Field label="Title" value={title} onChangeText={setTitle} placeholder="5 ways to light a small room" />
              <Button label="Start a post" busy={busy} disabled={busy || !title.trim()} onPress={start} />
            </Card>
          </Section>
          <Section title="Your posts">
            {d.posts.length === 0 ? (
              <EmptyState heading="No posts yet" body="Start one above. It stays a draft until you publish it." />
            ) : (
              <List>
                {d.posts.map((p) => (
                  <Row key={p.id} href={`/blog/${p.id}`} title={p.title} subtitle={postState(p)} a11y={`${p.title}, ${postState(p)}`} />
                ))}
              </List>
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}
