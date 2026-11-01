import { useState } from "react";
import { Share, View } from "react-native";
import { send, useApi } from "../../src/api";
import { when } from "../../src/format";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, List, LoadError, Loading, Pill, Row, Screen, Section, Segmented, Toggle } from "../../src/ui";
import { space, type Tone } from "../../src/theme";

type Sale = {
  id: string;
  title: string;
  percentOff: number;
  status: "scheduled" | "running" | "ended";
  covers: string;
  startsAt: string;
  endsAt: string | null;
  countdown: boolean;
  result?: { text: string; vs: string | null; tone: Tone } | null;
  early?: { code: string; startsAt: string | null; customerTag: string | null; link: string } | null;
};

const LOWEST = [
  ["eu", "Visitors in Europe", "Where the law asks for it: the EU, the rest of the EEA, the UK and Switzerland."],
  ["everyone", "Everyone", "Honest pricing builds trust anywhere."],
  ["off", "Nobody", "Only if you don't sell to Europe."],
] as const;

const STATUS: Record<Sale["status"], { label: string; tone: Tone }> = {
  running: { label: "On now", tone: "success" },
  scheduled: { label: "Coming", tone: "info" },
  ended: { label: "Ended", tone: "neutral" },
};

/** Sales: start one on everything from the phone, keep it on longer, or end it. */
export default function SalesScreen() {
  const list = useApi<{ sales: Sale[]; lowestPriceNote?: string }>("sales");
  const [title, setTitle] = useState("");
  const [percent, setPercent] = useState("");
  const [days, setDays] = useState("3");
  const [countdown, setCountdown] = useState(false);
  const [later, setLater] = useState(false);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("09:00");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: Tone; text: string } | null>(null);

  async function run(key: string, path: string, payload: unknown, label: string, method: "POST" | "PUT" = "POST") {
    setBusy(key);
    try {
      const r = await send<{ message: string }>(path, method, payload, label);
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
    let startsAt: string | null = null;
    if (later) {
      // On the phone's clock, like the product launch time.
      const at = new Date(`${day.trim()}T${time.trim()}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day.trim()) || !/^\d{1,2}:\d{2}$/.test(time.trim()) || Number.isNaN(at.getTime())) {
        return setNote({ tone: "critical", text: "Enter the day like 2026-12-01 and the time like 18:00." });
      }
      startsAt = at.toISOString();
    }
    const ok = await run("start", "sales", { title: title.trim(), percentOff: n, days: days === "open" ? null : Number(days), countdown, startsAt }, `${later ? "Schedule" : "Start"} ${title.trim()}`);
    if (ok) {
      setTitle("");
      setPercent("");
      setCountdown(false);
      setLater(false);
      setDay("");
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
          <Segmented
            label="Starts"
            options={[
              ["now", "Now"],
              ["later", "Later"],
            ]}
            value={later ? "later" : "now"}
            onChange={(v) => setLater(v === "later")}
          />
          {later ? (
            <>
              <Field label="Day" value={day} onChangeText={setDay} placeholder="2026-12-01" keyboardType="numbers-and-punctuation" autoCapitalize="none" />
              <Field label="Time" value={time} onChangeText={setTime} placeholder="09:00" keyboardType="numbers-and-punctuation" autoCapitalize="none" hint="24-hour, on your phone's clock." />
            </>
          ) : null}
          <Button label={later ? "Schedule the sale" : "Start the sale"} busy={busy === "start"} disabled={!title.trim() || !percent.trim() || (later && !day.trim())} onPress={start} />
          <Body muted>On everything but gift cards, with the old price crossed out, and it ends by itself. Sales on a collection or chosen products are on the website.</Body>
        </Card>
      </Section>
      <List>
        <Row title="Deal of the day" subtitle="One product a day at a lower price, with one link to share" href="/daily-deals" />
      </List>
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
              {x.result ? (
                <View accessible aria-label={`Results of ${x.title}: ${x.result.text}${x.result.vs ? `, ${x.result.vs}` : ""}`} style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap", alignItems: "center" }}>
                  <Body>{x.result.text}</Body>
                  {x.result.vs ? <Pill label={x.result.vs} tone={x.result.tone} /> : null}
                </View>
              ) : null}
              {x.status === "scheduled" ? <EarlyAccess sale={x} busy={busy} run={run} /> : null}
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
      {list.data?.lowestPriceNote ? (
        <Section title="Lowest earlier price">
          <Body muted>In the EU, a reduced price has to show the lowest price of the 30 days before the discount. Your store works it out and shows it under crossed-out prices.</Body>
          <List>
            {LOWEST.map(([value, label, hint]) => (
              <Row
                key={value}
                title={label}
                subtitle={hint}
                a11y={`Show it to ${label}${list.data!.lowestPriceNote === value ? ", picked" : ""}`}
                right={list.data!.lowestPriceNote === value ? "✓" : undefined}
                onPress={() => {
                  if (busy || list.data!.lowestPriceNote === value) return;
                  void run("lowest", "sales/lowest-price", { note: value }, "Lowest earlier price", "PUT");
                }}
              />
            ))}
          </List>
        </Section>
      ) : null}
    </Screen>
  );
}

const BEFORE = [
  ["0", "From now"],
  ["24", "1 day before"],
  ["48", "2 days before"],
  ["72", "3 days before"],
] as const;

/** A scheduled sale's early access: a code with the same percent off that stops when the sale starts. */
function EarlyAccess({ sale: x, busy, run }: { sale: Sale; busy: string | null; run: (key: string, path: string, payload: unknown, label: string) => Promise<boolean> }) {
  const [hours, setHours] = useState<(typeof BEFORE)[number][0]>("0");
  const [tag, setTag] = useState("");
  if (x.early) {
    const e = x.early;
    return (
      <View style={{ gap: space(2) }}>
        <Body>
          {`Early access with the code ${e.code}${e.startsAt && new Date(e.startsAt) > new Date() ? `, from ${when(e.startsAt)}` : ""} until the sale starts${e.customerTag ? `, only for customers tagged “${e.customerTag}”` : ", for anyone with the link"}.`}
        </Body>
        <Body muted>{e.link}</Body>
        <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
          <Button label="Share the link" kind="secondary" a11y={`Share the early access link to ${x.title}`} onPress={() => void Share.share({ message: e.link })} />
          <Button label="Stop early access" kind="ghost" a11y={`Stop early access to ${x.title}`} busy={busy === `noearly-${x.id}`} disabled={!!busy} onPress={() => void run(`noearly-${x.id}`, `sales/${x.id}`, { action: "end-early" }, `Stop early access to ${x.title}`)} />
        </View>
      </View>
    );
  }
  return (
    <View style={{ gap: space(2) }}>
      <Body muted>{`Let subscribers or your best customers in first: a code with the same ${x.percentOff}% off that stops when the sale starts.`}</Body>
      <Segmented label={`Early access to ${x.title} from`} options={BEFORE.map(([v, l]) => [v, l] as [typeof v, string])} value={hours} onChange={setHours} />
      <Field label="Only customers tagged (optional)" value={tag} onChangeText={setTag} placeholder="vip" autoCapitalize="none" />
      <Button
        label="Give early access"
        kind="secondary"
        a11y={`Give early access to ${x.title}`}
        busy={busy === `early-${x.id}`}
        disabled={!!busy}
        onPress={() => void run(`early-${x.id}`, `sales/${x.id}`, { action: "early", hours: Number(hours), tag: tag.trim() }, `Early access to ${x.title}`)}
      />
    </View>
  );
}
