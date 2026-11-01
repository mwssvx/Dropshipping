import { useState } from "react";
import { api, useApi } from "../src/api";
import { when } from "../src/format";
import { BackLink, Banner, Body, Button, Card, EmptyState, List, LoadError, Loading, Pill, Row, Screen, Section } from "../src/ui";

type Delivery = { id: string; event: string; status: "pending" | "delivered" | "failed"; attempts: number; code: number | null; error: string | null; at: string };
type Data = {
  keys: { id: string; name: string; prefix: string; access: "read" | "write"; lastUsedAt: string | null }[];
  webhooks: { id: string; url: string; active: boolean; events: string[]; deliveries: Delivery[] }[];
};

function deliveryLabel(d: Delivery) {
  const code = d.code ? ` · ${d.code}` : "";
  if (d.status === "delivered") return `Delivered${code}`;
  if (d.status === "failed") return `Gave up after ${d.attempts} tries${code}`;
  return d.attempts ? `Retrying (${d.attempts} ${d.attempts === 1 ? "try" : "tries"})${code}` : "Waiting";
}

/** API keys and webhooks: revoke a key that leaked, pause or test a webhook, and resend a delivery that failed. New keys and webhooks are made on the web. */
export default function DevelopersScreen() {
  const data = useApi<Data>("developers");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;

  async function run(key: string, path: string, method: "POST" | "PUT" | "DELETE", body?: unknown) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { method, body });
      setNote({ tone: "success", text: r.message });
      setConfirm(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Developers" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Your own tools read and update orders and products with an API key, and hear about new orders through webhooks. Make new keys and webhooks under Developers on the web.</Body>
          <Section title="API keys">
            {d.keys.length ? (
              <List>
                {d.keys.map((k) => (
                  <Row
                    key={k.id}
                    title={`${k.name} · ${k.prefix}…`}
                    subtitle={`Last used ${k.lastUsedAt ? when(k.lastUsedAt) : "never"}`}
                    right={<Pill label={k.access === "write" ? "Read and write" : "Read only"} tone={k.access === "write" ? "warning" : "neutral"} />}
                  />
                ))}
              </List>
            ) : (
              <EmptyState heading="No keys yet" body="Nothing can use your store's API." />
            )}
            {d.keys.map((k) =>
              confirm === k.id ? (
                <Card key={k.id}>
                  <Body>Revoke {k.name}? Anything using it stops working straight away. This can't be undone.</Body>
                  <Button label={`Revoke ${k.name} now`} kind="danger" busy={busy === k.id} disabled={!!busy} onPress={() => void run(k.id, `developers/keys/${k.id}`, "DELETE")} />
                  <Button label="Keep it" kind="ghost" onPress={() => setConfirm(null)} />
                </Card>
              ) : (
                <Button key={k.id} label={`Revoke ${k.name}…`} kind="secondary" disabled={!!busy} onPress={() => setConfirm(k.id)} />
              ),
            )}
          </Section>

          <Section title="Webhooks">
            {d.webhooks.length === 0 ? <EmptyState heading="No webhooks yet" body="Add one on the web to be told about new orders the moment they happen." /> : null}
            {d.webhooks.map((w) => (
              <Section key={w.id} title={w.url}>
                <Card>
                  <Pill label={w.active ? "On" : "Paused"} tone={w.active ? "success" : "neutral"} />
                  <Body muted>{w.events.join(", ")}</Body>
                  <Button label="Send test" kind="secondary" a11y={`Send a test to ${w.url}`} busy={busy === `test-${w.id}`} disabled={!!busy} onPress={() => void run(`test-${w.id}`, `developers/webhooks/${w.id}/test`, "POST")} />
                  <Button
                    label={w.active ? "Pause" : "Turn back on"}
                    kind="secondary"
                    busy={busy === `active-${w.id}`}
                    disabled={!!busy}
                    onPress={() => void run(`active-${w.id}`, `developers/webhooks/${w.id}`, "PUT", { active: !w.active })}
                  />
                  {confirm === w.id ? (
                    <Button label="Remove it now" kind="danger" busy={busy === w.id} disabled={!!busy} onPress={() => void run(w.id, `developers/webhooks/${w.id}`, "DELETE")} />
                  ) : (
                    <Button label="Remove…" kind="ghost" disabled={!!busy} onPress={() => setConfirm(w.id)} />
                  )}
                </Card>
                {w.deliveries.length ? (
                  <List>
                    {w.deliveries.map((x) => (
                      <Row
                        key={x.id}
                        title={`${x.event} · ${deliveryLabel(x)}`}
                        subtitle={`${when(x.at)}${x.error && x.status !== "delivered" ? ` · ${x.error}` : ""}`}
                        onPress={x.status === "delivered" || busy ? undefined : () => void run(`retry-${x.id}`, `developers/deliveries/${x.id}/retry`, "POST")}
                        a11y={x.status === "delivered" ? undefined : `Send ${x.event} again`}
                      />
                    ))}
                  </List>
                ) : null}
              </Section>
            ))}
          </Section>
        </>
      )}
    </Screen>
  );
}
