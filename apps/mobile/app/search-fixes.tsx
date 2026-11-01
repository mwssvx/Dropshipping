import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, LoadError, Loading, Row, Screen, Section } from "../src/ui";
import { space } from "../src/theme";

type Data = { fixes: { from: string; to: string }[]; nothing: { term: string; searches: number }[]; max: number; maxFixes: number };

/**
 * Search fixes: when shoppers search for words the products don't use, like "lampshade" or a
 * misspelling, point them at words that find what they meant. Searches from the last 30 days that
 * found nothing are listed; tapping one fills it in.
 */
export default function SearchFixesScreen() {
  const data = useApi<Data>("search-fixes");
  // From Analytics: a search that found nothing, to fix.
  const params = useLocalSearchParams<{ from?: string }>();
  const [from, setFrom] = useState(params.from ?? "");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;

  async function run(key: string, path: string, init: { method: string; body?: unknown }, after?: () => void) {
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
    <Screen title="Search fixes" back={<BackLink href="/products" label="Products" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>When shoppers search for words your products don't use, like "lampshade" or a misspelling, point those words at ones that find what they meant. The store shows those results and says so.</Body>
          <Section title="Found nothing">
            {d.nothing.length === 0 ? (
              <EmptyState heading="Nothing to fix" body="Every search in the last 30 days found something, or already has a fix." />
            ) : (
              <Card>
                <Body muted>Searches from the last 30 days that found nothing. Tap one to fix it.</Body>
                {d.nothing.map((t) => (
                  <Row
                    key={t.term}
                    title={t.term}
                    subtitle={t.searches === 1 ? "1 search" : `${t.searches} searches`}
                    a11y={`Fix “${t.term}”, ${t.searches === 1 ? "1 search" : `${t.searches} searches`}`}
                    onPress={() => {
                      setFrom(t.term);
                      setTo("");
                    }}
                  />
                ))}
              </Card>
            )}
          </Section>
          <Section title="New fix">
            <Card>
              <Field label="When shoppers search for" value={from} onChangeText={setFrom} placeholder="lampshade" autoCapitalize="none" />
              <Field label="Show the results for" value={to} onChangeText={setTo} placeholder="lamp shade" autoCapitalize="none" hint={`Up to ${d.max} characters each.`} />
              <Button
                label="Save fix"
                busy={busy === "add"}
                disabled={!!busy || !from.trim() || !to.trim()}
                onPress={() =>
                  run("add", "search-fixes", { method: "PUT", body: { from, to } }, () => {
                    setFrom("");
                    setTo("");
                  })
                }
              />
            </Card>
          </Section>
          <Section title="Your search fixes">
            {d.fixes.length === 0 ? (
              <EmptyState heading="No fixes yet" body="Searches show their own results until you add one." />
            ) : (
              <>
                <Body muted>{`${d.fixes.length} of ${d.maxFixes}.`}</Body>
                {d.fixes.map((f) => (
                  <Card key={f.from}>
                    <View role="group" aria-label={f.from} style={{ gap: space(1) }}>
                      <Body>{`“${f.from}” shows the results for “${f.to}”`}</Body>
                      <Button
                        label="Remove"
                        kind="secondary"
                        a11y={`Remove the fix for “${f.from}”`}
                        busy={busy === `del:${f.from}`}
                        disabled={!!busy}
                        onPress={() => run(`del:${f.from}`, `search-fixes/${encodeURIComponent(f.from)}`, { method: "DELETE" })}
                      />
                    </View>
                  </Card>
                ))}
              </>
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}
