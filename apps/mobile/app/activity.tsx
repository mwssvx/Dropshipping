import { useState } from "react";
import { View } from "react-native";
import { useApi } from "../src/api";
import { BackLink, Body, Button, EmptyState, List, LoadError, Loading, Row, Screen, Section, Segmented } from "../src/ui";
import { space } from "../src/theme";

type Entry = { id: string; email: string; summary: string; createdAt: string; orderId: string | null };
type Data = { members: { userId: string; email: string; name: string | null; role: string }[]; entries: Entry[]; next: string | null };

const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const timeLabel = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
/** "Refunded $12.00" reads as "ada@x.com refunded $12.00" after the name, as on the website. */
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

/** What people on the team did, newest first: refunds, price changes, orders sent, codes and settings. */
export default function ActivityScreen() {
  const [person, setPerson] = useState("");
  const [before, setBefore] = useState<string | null>(null);
  const q = new URLSearchParams({ ...(person ? { person } : {}), ...(before ? { before } : {}) }).toString();
  const data = useApi<Data>(`activity${q ? `?${q}` : ""}`);
  const d = data.data;
  const days: { label: string; items: Entry[] }[] = [];
  for (const e of d?.entries ?? []) {
    const label = dayLabel.format(new Date(e.createdAt));
    if (days.at(-1)?.label !== label) days.push({ label, items: [] });
    days.at(-1)!.items.push(e);
  }
  return (
    <Screen title="Activity" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      <Body muted>What people on your team did, in the app and on the website. Kept for a little over a year.</Body>
      {d && d.members.length > 1 ? (
        <Segmented
          label="Whose activity"
          value={person}
          onChange={(p) => {
            setPerson(p);
            setBefore(null);
          }}
          options={[["", "Everyone"], ...d.members.slice(0, 4).map((m) => [m.userId, m.name || m.email.split("@")[0]!] as [string, string])]}
        />
      ) : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : days.length === 0 ? (
        <EmptyState heading={before ? "Nothing earlier" : "Nothing yet"} body="Refunds, product changes and other things people on your team do show up here." />
      ) : (
        days.map((g) => (
          <Section key={g.label} title={g.label}>
            <List>
              {g.items.map((e) => (
                <Row
                  key={e.id}
                  title={`${e.email} ${lower(e.summary)}`}
                  subtitle={timeLabel.format(new Date(e.createdAt))}
                  href={e.orderId ? (`/orders/${e.orderId}` as never) : undefined}
                />
              ))}
            </List>
          </Section>
        ))
      )}
      <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
        {before ? <Button label="Newest" kind="secondary" onPress={() => setBefore(null)} /> : null}
        {d?.next ? <Button label="Older" kind="secondary" onPress={() => setBefore(d.next)} /> : null}
      </View>
    </Screen>
  );
}
