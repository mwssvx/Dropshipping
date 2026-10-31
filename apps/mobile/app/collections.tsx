import { useState } from "react";
import { Share, View } from "react-native";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, LoadError, Loading, Pill, Screen, Section } from "../src/ui";
import { space } from "../src/theme";

type Collection = { id: string; title: string; auto: boolean; productCount: number; url: string };

/**
 * The store's collections, with how many products each holds. Make a hand-picked one here and fill
 * it from each product's screen; automatic ones are set up on the website, where their rules live.
 */
export default function CollectionsScreen() {
  const data = useApi<{ collections: Collection[] }>("collections");
  const [title, setTitle] = useState("");
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
    <Screen title="Collections" back={<BackLink href="/products" label="Products" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Group products so buyers can browse, like "Best sellers" or "Gifts under $30".</Body>
          <Section title="Your collections">
            {d.collections.length === 0 ? <EmptyState heading="No collections yet" body="Make one below, then put products in it from their screens." /> : null}
            {d.collections.map((c) => (
              <Card key={c.id}>
                <View role="group" aria-label={c.title} style={{ gap: space(1) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                    <Heading>{c.title}</Heading>
                    <Pill label={c.auto ? "Fills by itself" : "Hand-picked"} tone={c.auto ? "info" : "neutral"} />
                  </View>
                  <Body>{c.productCount === 1 ? "1 product" : `${c.productCount} products`}</Body>
                  {c.auto ? <Body muted>Its rules are changed on the website.</Body> : null}
                  <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                    <Button label="Share" kind="secondary" a11y={`Share ${c.title}`} onPress={() => void Share.share({ message: `${c.title}: ${c.url}`, url: c.url })} />
                    {confirm === c.id ? (
                      <Button label={`Delete ${c.title}`} kind="danger" busy={busy === `del:${c.id}`} disabled={!!busy} onPress={() => run(`del:${c.id}`, `collections/${c.id}`, { method: "DELETE" }, () => setConfirm(null))} />
                    ) : (
                      <Button label="Delete…" kind="ghost" a11y={`Delete ${c.title}…`} disabled={!!busy} onPress={() => setConfirm(c.id)} />
                    )}
                  </View>
                </View>
              </Card>
            ))}
          </Section>
          <Section title="New collection">
            <Card>
              <Field label="Name" value={title} onChangeText={setTitle} placeholder="Summer picks" />
              <Body muted>It starts empty. Open a product and switch this collection on under Collections to put it in.</Body>
              <Button label="Make collection" busy={busy === "add"} disabled={!!busy || !title.trim()} onPress={() => run("add", "collections", { body: { title } }, () => setTitle(""))} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
