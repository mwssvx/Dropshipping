import { useState } from "react";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Row, List, Screen, Section, Segmented, Toggle } from "../src/ui";

type Results = { sent: number; used: number; salesMinor: number };
type Data = {
  currency: string;
  winback: Results & { offer: { afterDays: number; percentOff: number; days: number } | null; due: number | null };
  birthday: Results & { offer: { percentOff: number; days: number } | null; known: number };
};
type After = "30" | "60" | "90" | "180";

/** Codes the daily emails send by themselves: to subscribers who've gone quiet, and on a subscriber's birthday. */
export default function WinbackScreen() {
  const data = useApi<Data>("winback");
  const [wb, setWb] = useState<{ on: boolean; afterDays: After; percentOff: string; days: string } | null>(null);
  const [bd, setBd] = useState<{ on: boolean; percentOff: string; days: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const w = wb ?? (d ? { on: !!d.winback.offer, afterDays: String(d.winback.offer?.afterDays ?? 60) as After, percentOff: String(d.winback.offer?.percentOff ?? 15), days: String(d.winback.offer?.days ?? 14) } : null);
  const b = bd ?? (d ? { on: !!d.birthday.offer, percentOff: String(d.birthday.offer?.percentOff ?? 15), days: String(d.birthday.offer?.days ?? 14) } : null);

  async function save(key: string, path: string, body: unknown, after: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { method: "PUT", body });
      setNote({ tone: "success", text: r.message });
      after();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const results = (r: Results, usedLabel: string, cur: string) => (
    <List>
      <Row title="Codes sent" right={<Body>{String(r.sent)}</Body>} a11y={`Codes sent: ${r.sent}`} />
      <Row title={usedLabel} right={<Body>{String(r.used)}</Body>} a11y={`${usedLabel}: ${r.used}`} />
      <Row title="Sales" right={<Body>{money(r.salesMinor, cur)}</Body>} a11y={`Sales: ${money(r.salesMinor, cur)}`} />
    </List>
  );

  return (
    <Screen title="Win-back and birthday codes" back={<BackLink href="/codes" label="Discount codes" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !w || !b ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Win-back emails">
            <Card>
              <Body muted>When someone who said yes to your emails hasn't ordered for a while, we email them a code of their own to come back. It works once, only with their email, and each person gets one per quiet spell.</Body>
              <Toggle label="Email a code to subscribers who haven't ordered in a while" value={w.on} onChange={(v) => setWb({ ...w, on: v })} />
              {w.on ? (
                <>
                  <Segmented
                    label="After their last order"
                    value={w.afterDays}
                    onChange={(v) => setWb({ ...w, afterDays: v })}
                    options={[
                      ["30", "30 days"],
                      ["60", "60 days"],
                      ["90", "90 days"],
                      ["180", "180 days"],
                    ]}
                  />
                  <Field label="Percent off" value={w.percentOff} onChangeText={(v) => setWb({ ...w, percentOff: v })} keyboardType="number-pad" />
                  <Field label="Days to use it" value={w.days} onChangeText={(v) => setWb({ ...w, days: v })} keyboardType="number-pad" />
                </>
              ) : null}
              {d.winback.due !== null ? <Body muted>{d.winback.due === 0 ? "Nobody is due one right now." : `${d.winback.due} ${d.winback.due === 1 ? "person is" : "people are"} due one. It goes out with the next daily emails.`}</Body> : null}
              <Button label="Save win-back emails" busy={busy === "winback"} disabled={!!busy || !wb} onPress={() => void save("winback", "winback", w, () => setWb(null))} />
            </Card>
            {results(d.winback, "Came back", d.currency)}
          </Section>

          <Section title="Birthday codes">
            <Card>
              <Body muted>Buyers can add their birthday (just the month and day) on their account page. On the day, everyone who said yes to your emails gets a code of their own, once a year.</Body>
              <Toggle label="Email subscribers a code on their birthday" value={b.on} onChange={(v) => setBd({ ...b, on: v })} />
              {b.on ? (
                <>
                  <Field label="Birthday percent off" value={b.percentOff} onChangeText={(v) => setBd({ ...b, percentOff: v })} keyboardType="number-pad" />
                  <Field label="Days to use the birthday code" value={b.days} onChangeText={(v) => setBd({ ...b, days: v })} keyboardType="number-pad" />
                </>
              ) : null}
              <Body muted>{d.birthday.known === 0 ? "No subscriber has added their birthday yet." : `${d.birthday.known} ${d.birthday.known === 1 ? "subscriber has" : "subscribers have"} added their birthday.`}</Body>
              <Button label="Save birthday codes" busy={busy === "birthday"} disabled={!!busy || !bd} onPress={() => void save("birthday", "birthday", b, () => setBd(null))} />
            </Card>
            {results(d.birthday, "Used", d.currency)}
          </Section>
        </>
      )}
    </Screen>
  );
}
