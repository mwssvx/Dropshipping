import { useState } from "react";
import { Text } from "react-native";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, List, LoadError, Loading, Row, Screen, Section, Stat, Toggle } from "../src/ui";
import { color } from "../src/theme";

type Data = {
  enabled: boolean;
  earnRate: number;
  value: string;
  describe: string;
  members: number;
  points: number;
  owedMinor: number;
  redeemedPoints: number;
  top: { customerId: string; name: string; points: number }[];
};

/**
 * Buyers earn points on what they pay for goods and swap them for store credit, so they come back.
 * Turn it on, set how many points they earn and what they're worth, and see who holds the most.
 */
export default function RewardsScreen() {
  const data = useApi<Data>("rewards");
  const cur = useSession().me?.shop.currency ?? "USD";
  const [edit, setEdit] = useState<{ enabled: boolean; earnRate: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const s = edit ?? (d ? { enabled: d.enabled, earnRate: String(d.earnRate), value: d.value } : null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("rewards", { method: "PUT", body: s });
      setNote({ tone: "success", text: r.message });
      setEdit(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Rewards" back={<BackLink href="/" label="Today" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !s ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Buyers earn points on what they pay for goods and swap them for store credit on their account page. Refunds take points back. Add or take points on a customer's page.</Body>
          <Section title="Settings">
            <Card>
              <Toggle label="Give reward points" value={s.enabled} onChange={(v) => setEdit({ ...s, enabled: v })} />
              <Field label={`Points per ${money(100, cur)} spent`} value={s.earnRate} onChangeText={(v) => setEdit({ ...s, earnRate: v })} keyboardType="number-pad" />
              <Field label="100 points are worth" value={s.value} onChangeText={(v) => setEdit({ ...s, value: v })} keyboardType="decimal-pad" />
              <Body muted>{`Buyers see: ${d.describe}`}</Body>
              <Button label="Save rewards" busy={busy} disabled={busy || !edit} onPress={save} />
            </Card>
          </Section>
          <Section title="So far">
            <Card>
              <Stat label="Buyers with points" value={d.members.toLocaleString("en-US")} />
              <Stat label="Points held" value={d.points.toLocaleString("en-US")} />
              <Stat label="Worth if all swapped" value={money(d.owedMinor, cur)} />
              <Stat label="Points swapped" value={d.redeemedPoints.toLocaleString("en-US")} />
            </Card>
          </Section>
          <Section title="Most points">
            {d.top.length ? (
              <List>
                {d.top.map((r) => (
                  <Row key={r.customerId} href={`/customers/${r.customerId}` as never} title={r.name} right={<Text style={{ color: color.ink }}>{`${r.points.toLocaleString("en-US")} points`}</Text>} />
                ))}
              </List>
            ) : (
              <EmptyState heading="No one has points yet" body="Buyers earn them from their next paid order." />
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}
