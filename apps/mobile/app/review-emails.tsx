import { useState } from "react";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen, Section, Toggle } from "../src/ui";

type Data = {
  currency: string;
  days: number;
  reminder: boolean;
  percent: number | null;
  requests: { sent: number; reviewed: number };
  reward: { sent: number; used: number; salesMinor: number };
};

/** The email asking buyers for a review after their order arrives, its reminder, and the thank-you code for reviewing. */
export default function ReviewEmailsScreen() {
  const data = useApi<Data>("review-emails");
  const [req, setReq] = useState<{ on: boolean; days: string; reminder: boolean } | null>(null);
  const [rew, setRew] = useState<{ on: boolean; percent: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const r = req ?? (d ? { on: d.days > 0, days: String(d.days || 7), reminder: d.reminder } : null);
  const w = rew ?? (d ? { on: d.percent !== null, percent: String(d.percent ?? 10) } : null);

  async function save(key: string, path: string, body: unknown, after: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const res = await api<{ message: string }>(path, { method: "PUT", body });
      setNote({ tone: "success", text: res.message });
      after();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Review emails" back={<BackLink href="/reviews" label="Reviews" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !r || !w ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Review requests">
            <Card>
              <Toggle label="Email buyers for a review" value={r.on} onChange={(v) => setReq({ ...r, on: v })} />
              {r.on ? (
                <>
                  <Field label="Days after their order arrives" value={r.days} onChangeText={(v) => setReq({ ...r, days: v })} keyboardType="number-pad" hint="1 to 30 days." />
                  <Toggle label="Send one reminder a week later to buyers who haven't reviewed yet" value={r.reminder} onChange={(v) => setReq({ ...r, reminder: v })} />
                </>
              ) : null}
              <Body muted>Once per order (twice with the reminder), with a link to the review form. Not for gifts, or buyers who unsubscribed from your emails.</Body>
              <Button label="Save review requests" busy={busy === "req"} disabled={!!busy || !req} onPress={() => void save("req", "review-emails/requests", r, () => setReq(null))} />
              {d.requests.sent > 0 ? <Body muted>{`Last 30 days: ${d.requests.sent} sent, and ${d.requests.reviewed} of those orders got a review.`}</Body> : null}
            </Card>
          </Section>
          <Section title="Thank-you code">
            <Card>
              <Toggle label="Thank buyers for a review with a code" value={w.on} onChange={(v) => setRew({ ...w, on: v })} />
              {w.on ? <Field label="Percent off their next order" value={w.percent} onChangeText={(v) => setRew({ ...w, percent: v })} keyboardType="number-pad" hint="5% to 30%." /> : null}
              <Body muted>Emailed as a one-time code (60 days, their email only) once they review something they bought, whatever the stars. Those reviews say "Got a thank-you code for reviewing", so shoppers know, as the FTC and Google ask.</Body>
              <Button label="Save thank-you code" busy={busy === "rew"} disabled={!!busy || !rew} onPress={() => void save("rew", "review-emails/reward", w, () => setRew(null))} />
              {d.reward.sent > 0 ? <Body muted>{`${d.reward.sent === 1 ? "1 code sent" : `${d.reward.sent} codes sent`}, ${d.reward.used} used, ${money(d.reward.salesMinor, d.currency)} in sales.`}</Body> : null}
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
