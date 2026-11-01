import { useState } from "react";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, List, LoadError, Loading, Row, Screen, Section } from "../src/ui";

type Data = { total: number; max: number; found: number; redirects: { id: string; from: string; to: string; hits: number }[] };
type Added = { message: string; added: number; skipped: { line: string; reason: string }[] };

/** Redirects: old links (a renamed product, pages from a store that moved here) that should still reach the right page. */
export default function RedirectsScreen() {
  const [search, setSearch] = useState("");
  const q = search.trim();
  const data = useApi<Data>(`redirects${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const [lines, setLines] = useState("");
  const [skipped, setSkipped] = useState<Added["skipped"]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;

  async function add() {
    setBusy("add");
    setNote(null);
    try {
      const r = await api<Added>("redirects", { body: { lines } });
      setNote({ tone: "success", text: r.message });
      setSkipped(r.skipped);
      // Lines that didn't work stay in the box to fix.
      setLines(r.skipped.map((s) => s.line).join("\n"));
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setNote(null);
    try {
      const r = await api<{ message: string }>(`redirects/${id}`, { method: "DELETE" });
      setNote({ tone: "success", text: r.message });
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Redirects" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <Body muted>A redirect is only used when nothing on your store is at that address. Changing a product's web address adds one for you.</Body>
      <Section title="Add redirects">
        <Card>
          <Field
            label="One per line: the old address, then where it goes"
            value={lines}
            onChangeText={setLines}
            multiline
            autoCapitalize="none"
            placeholder={"/products/old-lamp /products/sunset-lamp"}
            hint="Full addresses work too; only the path is kept."
          />
          {skipped.length ? (
            <Banner tone="warning">{`Not added:\n${skipped.map((s) => `${s.line}: ${s.reason}`).join("\n")}`}</Banner>
          ) : null}
          <Button label="Add redirects" busy={busy === "add"} disabled={!!busy || !lines.trim()} onPress={add} />
        </Card>
      </Section>
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <Section title={`Your redirects (${d.total} of ${d.max})`}>
          {d.total > 0 ? <Field label="Search redirects" value={search} onChangeText={setSearch} autoCapitalize="none" placeholder="/products/old-lamp" /> : null}
          {d.redirects.length === 0 ? (
            <EmptyState heading={q && d.total ? "No redirects match" : "No redirects yet"} body={q && d.total ? "Try part of the old or new address." : "Add the old links above."} />
          ) : (
            <List>
              {d.redirects.map((r) => (
                <Row
                  key={r.id}
                  title={r.from}
                  subtitle={`Goes to ${r.to} · ${r.hits === 1 ? "1 visit" : `${r.hits} visits`}`}
                  right={<Button label="Remove" kind="ghost" a11y={`Remove redirect from ${r.from}`} busy={busy === r.id} disabled={!!busy} onPress={() => void remove(r.id)} />}
                />
              ))}
            </List>
          )}
          {d.found > d.redirects.length ? <Body muted>{`Showing ${d.redirects.length} of ${d.found}. Search to find the rest.`}</Body> : null}
        </Section>
      )}
    </Screen>
  );
}
