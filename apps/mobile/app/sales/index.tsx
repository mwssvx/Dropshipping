import { useState } from "react";
import { View } from "react-native";
import { send, useApi } from "../../src/api";
import { when } from "../../src/format";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, LoadError, Loading, Pill, Screen, Section, Segmented, Toggle } from "../../src/ui";
import { space, type Tone } from "../../src/theme";

type Sale = { id: string; title: string; percentOff: number; status: "scheduled" | "running" | "ended"; covers: string; startsAt: string; endsAt: string | null; countdown: boolean };

const STATUS: Record<Sale["status"], { label: string; tone: Tone }> = {
  running: { label: "On now", tone: "success" },
  scheduled: { label: "Coming", tone: "info" },
  ended: { label: "Ended", tone: "neutral" },
};

/** Sales: start one on everything from the phone, keep it on longer, or end it. */
export default function SalesScreen() {
  const list = useApi<{ sales: Sale[] }>("sales");
  const [title, setTitle] = useState("");
  const [percent, setPercent] = useState("");
  const [days, setDays] = useState("3");
  const [countdown, setCountdown] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: Tone; text: string } | null>(null);

  async function run(key: string, path: string, payload: unknown, label: string) {
    setBusy(key);
    try {
      const r = await send<{ message: string }>(path, "POST", payload, label);
      setNote({ tone: "success", text: r === "queued" ? "Saved. It's sent when you're back online." : r.message });
      list.reload();
      return true;
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    const n = Number(percent);
    if (!Number.isInteger(n) || n < 1) return setNote({ tone: "critical", text: "Enter a whole percent off, like 20." });
    const ok = await run("start", "sales", { title: title.trim(), percentOff: n, days: days === "open" ? null : Number(days), countdown }, `Start ${title.trim()}`);
    if (ok) {
      setTitle("");
      setPercent("");
      setCountdown(false);
    }
  }

  const sales = list.data?.sales;
  return (
    <Screen title="Sales" back={<BackLink href="/" label="Today" />} onRefresh={list.reload} refreshing={list.loading && !!sales}>
      {note && <Banner tone={note.tone}>{note.text}</Banner>}
      <Section title="Start a sale">
        <Card>
          <Field label="Sale name" value={title} onChangeText={setTitle} placeholder="Weekend sale" autoCapitalize="sentences" />
          <Field label="Percent off everything" value={percent} onChangeText={setPercent} keyboardType="number-pad" placeholder="20" />
          <Segmented
            label="How long"
            options={[
              ["1", "1 day"],
              ["3", "3 days"],
              ["7", "A week"],
              ["open", "Until I end it"],
            ]}
            value={days}
            onChange={(v) => {
              setDays(v);
              if (v === "open") setCountdown(false);
            }}
          />
          {days !== "open" ? <Toggle label="Countdown on the store" value={countdown} onChange={setCountdown} /> : null}
          <Button label="Start the sale" busy={busy === "start"} disabled={!title.trim() || !percent.trim()} onPress={start} />
          <Body muted>It starts now, on everything but gift cards, with the old price crossed out. Sales on a collection or chosen products, or starting later, are on the website.</Body>
        </Card>
      </Section>
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!sales ? (
        list.loading ? <Loading /> : null
      ) : sales.length === 0 ? (
        <EmptyState heading="No sales yet" body="Start one above for a weekend or a holiday." />
      ) : (
        <Section title="Your sales">
          {sales.map((x) => (
            <Card key={x.id}>
              <View style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
                <Heading>{`${x.title} · ${x.percentOff}% off`}</Heading>
                <Pill label={STATUS[x.status].label} tone={STATUS[x.status].tone} />
              </View>
              <Body muted>
                {x.covers}
                {x.status === "scheduled" ? ` · starts ${when(x.startsAt)}` : ""}
                {x.endsAt ? ` · ${x.status === "ended" ? "ended" : "ends"} ${when(x.endsAt)}` : " · until you end it"}
                {x.countdown && x.status !== "ended" ? " · with a countdown" : ""}
              </Body>
              {x.status !== "ended" ? (
                <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                  {x.endsAt ? (
                    <Button label="One more day" kind="secondary" a11y={`Keep ${x.title} on one more day`} busy={busy === `extend-${x.id}`} onPress={() => run(`extend-${x.id}`, `sales/${x.id}`, { action: "extend", days: 1 }, `Keep ${x.title} on longer`)} />
                  ) : null}
                  <Button label={x.status === "scheduled" ? "Cancel" : "End now"} kind="danger" a11y={`End ${x.title} now`} busy={busy === `end-${x.id}`} onPress={() => run(`end-${x.id}`, `sales/${x.id}`, { action: "end" }, `End ${x.title}`)} />
                </View>
              ) : null}
            </Card>
          ))}
        </Section>
      )}
    </Screen>
  );
}
