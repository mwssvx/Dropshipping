import { useState } from "react";
import { api, useApi } from "../src/api";
import { when } from "../src/format";
import { BackLink, Banner, Body, Button, Card, List, LoadError, Loading, Pill, Row, Screen, Section, Toggle } from "../src/ui";

type Data = {
  email: string;
  shopName: string;
  twoStep: { on: boolean; since: string | null; recoveryCodesLeft: number };
  summary: boolean | null;
  signIns: { id: string; device: string; current: boolean; signedInAt: string; lastSeenAt: string }[];
};

/** "Active now", "Active 12 minutes ago", "Active 3 days ago", as on the web. */
function ago(iso: string) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 10) return "Active now";
  if (minutes < 60) return `Active ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "Active 1 hour ago" : `Active ${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Active yesterday" : `Active ${days} days ago`;
}

/** Your own account: two-step sign-in, the Monday summary email, and where you're signed in. */
export default function AccountScreen() {
  const data = useApi<Data>("account");
  const [summary, setSummary] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;

  async function run(key: string, path: string, method: "POST" | "PUT" | "DELETE", body?: unknown, after?: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { method, body });
      setNote({ tone: "success", text: r.message });
      after?.();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const others = d ? d.signIns.filter((s) => !s.current) : [];
  const summaryV = summary ?? d?.summary ?? false;
  return (
    <Screen title="Your account" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Signed in as {d.email}. These settings are yours, on every store you work on.</Body>
          <Section title="Two-step sign-in">
            <Card>
              <Pill label={d.twoStep.on ? "On" : "Off"} tone={d.twoStep.on ? "success" : "warning"} />
              {d.twoStep.on ? (
                <Body>
                  {`On since ${when(d.twoStep.since)}. ${d.twoStep.recoveryCodesLeft === 1 ? "1 recovery code left." : `${d.twoStep.recoveryCodesLeft} recovery codes left.`}`}
                  {d.twoStep.recoveryCodesLeft <= 3 ? " Make new ones under Your account on the web." : ""}
                </Body>
              ) : (
                <Body>Signing in takes your password and a code from an app on your phone, so someone who learns your password still can't get into your stores or your payouts. Set it up under Your account on the web, where you can scan the code with this phone.</Body>
              )}
            </Card>
          </Section>

          {d.summary !== null ? (
            <Section title="Monday summary">
              <Card>
                <Body muted>One email a week with last week's sales, orders, best sellers and profit, and anything waiting for you. Quiet weeks with nothing waiting don't send one.</Body>
                <Toggle label={`Email me a summary of ${d.shopName} every Monday`} value={summaryV} onChange={setSummary} />
                <Button label="Save" kind="secondary" busy={busy === "summary"} disabled={!!busy || summary === null} onPress={() => void run("summary", "account/summary", "PUT", { on: summaryV }, () => setSummary(null))} />
              </Card>
            </Section>
          ) : null}

          <Section title="Where you're signed in">
            <Body muted>Each browser and phone signed in to your account. Don't recognise one? Sign it out and change your password.</Body>
            <List>
              {d.signIns.map((s) => (
                <Row
                  key={s.id}
                  title={s.device}
                  subtitle={`Signed in ${when(s.signedInAt)} · ${s.current ? "Active now" : ago(s.lastSeenAt)}`}
                  right={s.current ? <Pill label="This device" tone="success" /> : undefined}
                />
              ))}
            </List>
            {others.map((s) => (
              <Button key={s.id} label={`Sign out ${s.device}`} kind="secondary" busy={busy === s.id} disabled={!!busy} onPress={() => void run(s.id, `account/sign-ins/${encodeURIComponent(s.id)}`, "DELETE")} />
            ))}
            {others.length > 1 ? <Button label="Sign out everywhere else" busy={busy === "others"} disabled={!!busy} onPress={() => void run("others", "account/sign-ins/others", "POST")} /> : null}
          </Section>
        </>
      )}
    </Screen>
  );
}
