import { useState } from "react";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, List, LoadError, Loading, Pill, Row, Screen, Section, Toggle } from "../src/ui";

type Data = {
  options: { code: string; name: string; english: string; on: boolean }[];
  summary: { language: string; name: string; done: number; total: number; outdated: number; missing: number }[];
};

/** The languages buyers can pick, and how much of the store's own words each has translated. */
export default function LanguagesScreen() {
  const data = useApi<Data>("languages");
  const [on, setOn] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const picked = on ?? d?.options.filter((o) => o.on).map((o) => o.code) ?? [];

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("languages", { method: "PUT", body: { languages: picked } });
      setNote({ tone: "success", text: r.message });
      setOn(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Store languages" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Each language gets its own address that search engines list. Buttons, the cart and checkout are translated for you. Your own words (products, collections, pages, menus and the home page) show in English until they're translated, on the web under Languages.</Body>
          <Section title="Languages buyers can pick">
            <Card>
              <Body muted>English is always on: it's your store's language.</Body>
              {d.options.map((o) => (
                <Toggle key={o.code} label={`${o.english} · ${o.name}`} value={picked.includes(o.code)} onChange={(v) => setOn(v ? [...picked, o.code] : picked.filter((c) => c !== o.code))} />
              ))}
              <Button label="Save languages" busy={busy} disabled={busy || on === null} onPress={save} />
            </Card>
          </Section>
          {d.summary.length ? (
            <Section title="Translated so far">
              <List>
                {d.summary.map((s) => {
                  const pct = s.total ? Math.round((s.done / s.total) * 100) : 100;
                  const bits = [`${s.done} of ${s.total} translated`];
                  if (s.outdated) bits.push(`${s.outdated} out of date`);
                  if (s.missing) bits.push(`${s.missing} not started`);
                  return <Row key={s.language} title={s.name} subtitle={bits.join(" · ")} right={<Pill label={`${pct}%`} tone={pct === 100 && !s.outdated ? "success" : "neutral"} />} />;
                })}
              </List>
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}
