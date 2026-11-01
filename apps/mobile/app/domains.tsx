import { useState } from "react";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, List, LoadError, Loading, Pill, Row, Screen, Section } from "../src/ui";

type Domain = { id: string; hostname: string; connected: boolean; verified: boolean; primary: boolean; lastError: string | null; record: { type: string; name: string; value: string } };
type Data = { free: string; domains: Domain[] };

/** The store's free address, and domains the merchant owns: the DNS record to add, checking it, and which is the main address. */
export default function DomainsScreen() {
  const data = useApi<Data>("domains");
  const [hostname, setHostname] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;

  async function run(key: string, path: string, method: "POST" | "DELETE", body?: unknown, after?: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { method, body });
      setNote({ tone: "success", text: r.message });
      after?.();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
      setConfirm(null);
      await data.reload();
    }
  }

  return (
    <Screen title="Domains" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Your free address">
            <Card>
              <Body>{d.free}</Body>
              <Body muted>This always works, even after you connect your own domain.</Body>
            </Card>
          </Section>
          <Section title="Connect your own domain">
            <Card>
              <Field
                label="Domain you own"
                value={hostname}
                onChangeText={setHostname}
                autoCapitalize="none"
                placeholder="shop.example.com"
                hint="Bought it somewhere like Namecheap, GoDaddy or Cloudflare? Add it here, then copy the record shown into that site."
              />
              <Button label="Connect domain" busy={busy === "add"} disabled={!!busy || !hostname.trim()} onPress={() => void run("add", "domains", "POST", { hostname }, () => setHostname(""))} />
            </Card>
          </Section>
          {d.domains.map((x) => (
            <Section key={x.id} title={x.hostname}>
              <Card>
                <List>
                  <Row
                    title={x.connected ? "Connected" : x.verified ? "Needs attention" : "Waiting for DNS"}
                    subtitle={x.connected ? `Buyers can shop at https://${x.hostname}. The security certificate is set up for you.` : (x.lastError ?? undefined)}
                    right={x.primary ? <Pill label="Main address" tone="info" /> : <Pill label={x.connected ? "Connected" : "Not yet"} tone={x.connected ? "success" : "warning"} />}
                  />
                </List>
                {!x.connected ? (
                  <>
                    <Body muted>{`Sign in where you bought ${x.hostname}, open its DNS settings and add this record. If there's already a ${x.record.type} record with the same name, edit it instead. Changes usually show up within an hour, and can take up to 48.`}</Body>
                    <List>
                      <Row title="Type" right={<Body>{x.record.type}</Body>} />
                      <Row title="Name" right={<Body>{x.record.name}</Body>} />
                      <Row title="Value" right={<Body>{x.record.value}</Body>} />
                    </List>
                    <Button label="Check now" kind="secondary" a11y={`Check ${x.hostname} now`} busy={busy === `check-${x.id}`} disabled={!!busy} onPress={() => void run(`check-${x.id}`, `domains/${x.id}/check`, "POST")} />
                  </>
                ) : null}
                {x.connected && !x.primary ? (
                  <Button label="Make main address" kind="secondary" a11y={`Make ${x.hostname} the main address`} busy={busy === `primary-${x.id}`} disabled={!!busy} onPress={() => void run(`primary-${x.id}`, `domains/${x.id}/primary`, "POST")} />
                ) : null}
                {confirm === x.id ? (
                  <Button label={`Remove ${x.hostname} now`} kind="danger" busy={busy === `remove-${x.id}`} disabled={!!busy} onPress={() => void run(`remove-${x.id}`, `domains/${x.id}`, "DELETE")} />
                ) : (
                  <Button label="Remove…" kind="ghost" a11y={`Remove ${x.hostname}…`} disabled={!!busy} onPress={() => setConfirm(x.id)} />
                )}
              </Card>
            </Section>
          ))}
        </>
      )}
    </Screen>
  );
}
