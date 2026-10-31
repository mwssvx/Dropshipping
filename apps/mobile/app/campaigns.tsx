import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, LoadError, Loading, Pill, Screen, Section, Segmented } from "../src/ui";
import { space } from "../src/theme";

type Audience = "subscribers" | "customers" | "not_bought" | "lapsed";
type Campaign = {
  id: string;
  subject: string;
  body: string;
  status: "draft" | "scheduled" | "sending" | "sent";
  audience: string;
  audienceLabel: string;
  scheduledFor: string | null;
  stats: { sent: number; clicks: number; orders: number; salesMinor: number };
};
type Data = { left: number; limit: number; hasAddress: boolean; audiences: { value: Audience; label: string; size: number }[]; campaigns: Campaign[] };

const STATUS = { draft: { label: "Draft", tone: "neutral" }, scheduled: { label: "Scheduled", tone: "info" }, sending: { label: "Sending", tone: "info" }, sent: { label: "Sent", tone: "success" } } as const;
const EMPTY = { subject: "", body: "", buttonLabel: "", buttonPath: "" };
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

/**
 * A short email to the people who said yes to emails: write it, send yourself a test, send it, and
 * see how many opened the link and bought. Free up to the monthly allowance.
 */
export default function CampaignsScreen() {
  const data = useApi<Data>("campaigns");
  const session = useSession();
  const cur = session.me?.shop.currency ?? "USD";
  const [form, setForm] = useState(EMPTY);
  const [audience, setAudience] = useState<Audience>("subscribers");
  const [address, setAddress] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const set = (k: keyof typeof EMPTY) => (v: string) => setForm({ ...form, [k]: v });

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

  const size = (a: string) => d?.audiences.find((x) => x.value === a)?.size ?? 0;

  return (
    <Screen title="Email campaigns" back={<BackLink href="/" label="Today" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>{`${size("subscribers")} ${size("subscribers") === 1 ? "subscriber" : "subscribers"} · ${d.left.toLocaleString("en-US")} of ${d.limit.toLocaleString("en-US")} free emails left this month. Every email has a one-click unsubscribe.`}</Body>
          {!d.hasAddress ? (
            <Card>
              <Heading>Your mailing address</Heading>
              <Body muted>The law asks for it at the foot of every marketing email. A PO box works.</Body>
              <Field label="Mailing address" value={address} onChangeText={setAddress} multiline placeholder="PO Box 12, Austin, TX 78701, USA" />
              <Button label="Save address" kind="secondary" busy={busy === "address"} disabled={!!busy || !address.trim()} onPress={() => run("address", "campaigns/address", { method: "PUT", body: { mailingAddress: address } }, () => setAddress(""))} />
            </Card>
          ) : null}
          <Section title="Campaigns">
            {d.campaigns.length === 0 ? <EmptyState heading="No campaigns yet" body="A short note about something new, with one link, works best." /> : null}
            {d.campaigns.map((c) => (
              <Card key={c.id}>
                <View role="group" aria-label={c.subject} style={{ gap: space(1) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                    <Heading>{c.subject}</Heading>
                    <Pill label={STATUS[c.status].label} tone={STATUS[c.status].tone} />
                  </View>
                  <Body muted>{c.audienceLabel}</Body>
                  {c.status === "draft" ? (
                    <>
                      <Body>{c.body.length > 200 ? `${c.body.slice(0, 199)}…` : c.body}</Body>
                      <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                        <Button
                          label="Send me a test"
                          kind="secondary"
                          busy={busy === `test:${c.id}`}
                          disabled={!!busy}
                          a11y={`Send me a test of ${c.subject}`}
                          onPress={() => run(`test:${c.id}`, `campaigns/${c.id}/test`, { body: {} })}
                        />
                        {confirm === c.id ? (
                          <Button
                            label={`Send to ${size(c.audience)} ${size(c.audience) === 1 ? "person" : "people"}`}
                            busy={busy === `send:${c.id}`}
                            disabled={!!busy}
                            onPress={() => run(`send:${c.id}`, `campaigns/${c.id}/send`, { body: {} }, () => setConfirm(null))}
                          />
                        ) : (
                          <Button label="Send…" onPress={() => setConfirm(c.id)} a11y={`Send ${c.subject}…`} />
                        )}
                        <Button label="Delete" kind="ghost" busy={busy === `del:${c.id}`} disabled={!!busy} a11y={`Delete the draft ${c.subject}`} onPress={() => run(`del:${c.id}`, `campaigns/${c.id}`, { method: "DELETE" })} />
                      </View>
                      {confirm === c.id ? <Body muted>It goes out now and can't be called back.</Body> : null}
                    </>
                  ) : (
                    <Body>{`${c.stats.sent} sent · ${pct(c.stats.clicks, c.stats.sent)} clicked · ${c.stats.orders} ${c.stats.orders === 1 ? "order" : "orders"} · ${money(c.stats.salesMinor, cur)}`}</Body>
                  )}
                </View>
              </Card>
            ))}
          </Section>
          <Section title="New campaign">
            <Card>
              <Field label="Subject" value={form.subject} onChangeText={set("subject")} placeholder="New: lamps that glow like sunset" />
              <Field label="Email" value={form.body} onChangeText={set("body")} multiline placeholder="Write a few lines, like a note to a friend." />
              <Field label="Button text (optional)" value={form.buttonLabel} onChangeText={set("buttonLabel")} placeholder="See the lamps" />
              <Field label="Button goes to (optional)" value={form.buttonPath} onChangeText={set("buttonPath")} autoCapitalize="none" placeholder="/collections/new" hint="A page on your store." />
              <Segmented
                label="Who gets it"
                value={audience}
                onChange={setAudience}
                options={d.audiences.map((a) => [a.value, `${a.label} (${a.size})`] as [Audience, string])}
              />
              <Button
                label="Save draft"
                busy={busy === "save"}
                disabled={!!busy || !form.subject.trim() || !form.body.trim()}
                onPress={() => run("save", "campaigns", { body: { ...form, audience } }, () => { setForm(EMPTY); setAudience("subscribers"); })}
              />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
