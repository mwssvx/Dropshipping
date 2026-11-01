import { useState } from "react";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, Heading, LoadError, Loading, Screen, Section } from "../src/ui";

type Data = { hasChanges: boolean; publishedAt: string | null; schedule: { at: string; until: string | null } | null; revertAt: string | null };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "2026-11-27" and "09:00" on this phone's clock, as a moment. Empty when the day is. */
function moment(day: string, time: string) {
  if (!day.trim()) return "";
  const d = new Date(`${day.trim()}T${time.trim() || "00:00"}`);
  return Number.isNaN(d.getTime()) ? "invalid" : d.toISOString();
}

/**
 * The store's look. It's designed on the website; here the draft goes live now, or by itself at a
 * time (a Black Friday look from Friday to Monday night), and switches back by itself.
 */
export default function StoreLookScreen() {
  const data = useApi<Data>("store-look");
  const [form, setForm] = useState({ day: "", time: "09:00", backDay: "", backTime: "00:00" });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;

  async function run(key: string, path: string, init: { method?: string; body?: unknown }) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, init);
      setNote({ tone: "success", text: r.message });
      setConfirm(false);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function schedule() {
    const at = moment(form.day, form.time);
    const until = moment(form.backDay, form.backTime);
    if (!at || at === "invalid") return setNote({ tone: "critical", text: "Enter the day it goes live as YYYY-MM-DD, and the time as 09:00." });
    if (until === "invalid") return setNote({ tone: "critical", text: "Enter the day it switches back as YYYY-MM-DD, or leave it empty." });
    void run("schedule", "store-look/schedule", { method: "PUT", body: { at, until } });
  }

  return (
    <Screen title="Store look" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Change colours, sections and banners in the theme editor on the website. Here you can put the new look live now, or have it go live and switch back by itself.</Body>
          {d.revertAt ? (
            <Section title="Live now">
              <Card>
                <Body>{`A scheduled look is live. It switches back to the earlier one on ${when(d.revertAt)}.`}</Body>
                <Button label="Keep this look" kind="secondary" busy={busy === "keep"} disabled={!!busy} onPress={() => run("keep", "store-look/keep", { method: "POST" })} />
              </Card>
            </Section>
          ) : null}
          {d.schedule ? (
            <Section title="Scheduled">
              <Card>
                <Heading>{`Goes live ${when(d.schedule.at)}`}</Heading>
                <Body>{d.schedule.until ? `Switches back ${when(d.schedule.until)}.` : "It stays until you change it."}</Body>
                {confirm ? (
                  <Button label="Cancel the scheduled look" kind="danger" busy={busy === "cancel"} disabled={!!busy} onPress={() => run("cancel", "store-look/schedule", { method: "DELETE" })} />
                ) : (
                  <Button label="Cancel…" kind="ghost" a11y="Cancel the scheduled look…" disabled={!!busy} onPress={() => setConfirm(true)} />
                )}
              </Card>
            </Section>
          ) : null}
          <Section title="Your draft">
            <Card>
              {d.hasChanges ? (
                <>
                  <Body>Your draft has changes that aren't on the store yet.</Body>
                  <Button label="Publish now" busy={busy === "publish"} disabled={!!busy} onPress={() => run("publish", "store-look/publish", { method: "POST" })} />
                  <Heading>Or schedule it</Heading>
                  <Field label="Goes live on" value={form.day} onChangeText={(v) => setForm({ ...form, day: v })} placeholder="2026-11-27" keyboardType="numbers-and-punctuation" autoCapitalize="none" />
                  <Field label="At" value={form.time} onChangeText={(v) => setForm({ ...form, time: v })} placeholder="09:00" keyboardType="numbers-and-punctuation" />
                  <Field label="Switches back on (optional)" value={form.backDay} onChangeText={(v) => setForm({ ...form, backDay: v })} placeholder="2026-12-01" keyboardType="numbers-and-punctuation" autoCapitalize="none" />
                  <Field label="Switches back at" value={form.backTime} onChangeText={(v) => setForm({ ...form, backTime: v })} placeholder="00:00" keyboardType="numbers-and-punctuation" hint="Times are on this phone's clock." />
                  <Button label={d.schedule ? "Schedule instead" : "Schedule"} kind="secondary" busy={busy === "schedule"} disabled={!!busy || !form.day.trim()} onPress={schedule} />
                </>
              ) : (
                <Body>The store shows your latest look. Change it in the theme editor on the website, then publish or schedule it here.</Body>
              )}
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
