import { useEffect, useState } from "react";
import { Share, View } from "react-native";
import { send, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, List, LoadError, Loading, Pill, Row, Screen, Section } from "../src/ui";
import { space, type Tone } from "../src/theme";

type Data = {
  link: string;
  today: string;
  firstFree: string;
  min: number;
  max: number;
  deals: { id: string; title: string; percentOff: number; on: boolean; day: string }[];
  products: { id: string; title: string }[];
};

/** Deal of the day: tap products in the order they run, one a day from the first day. */
export default function DailyDealsScreen() {
  const data = useApi<Data>("daily-deals");
  const [start, setStart] = useState("");
  const [percent, setPercent] = useState("30");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: Tone; text: string } | null>(null);
  const d = data.data;
  useEffect(() => {
    if (d) setStart(d.firstFree);
  }, [d?.firstFree]);

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : d && p.length >= d.max ? p : [...p, id]));
  }

  async function plan() {
    const n = Number(percent);
    if (!Number.isInteger(n) || n < 1) return setNote({ tone: "critical", text: "Enter a whole percent off, like 30." });
    setBusy(true);
    try {
      const r = await send<{ message: string }>("daily-deals", "POST", { productIds: picked, percentOff: n, startDate: start.trim() }, "Plan deals of the day");
      setNote({ tone: "success", text: r === "queued" ? "Saved. It's sent when you're back online." : r.message });
      setPicked([]);
      data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Deal of the day" back={<BackLink href="/sales" label="Sales" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note && <Banner tone={note.tone}>{note.text}</Banner>}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>One product a day at a lower price, from midnight to midnight. Each deal has a countdown, and one link always goes to the deal that's on.</Body>
          <Section title="Link to share">
            <Card>
              <Body>{d.link}</Body>
              <Button label="Share the link" kind="secondary" onPress={() => void Share.share({ message: d.link })} />
            </Card>
          </Section>
          {d.deals.length ? (
            <Section title="Deals planned">
              <List>
                {d.deals.map((x) => (
                  <Row key={x.id} title={x.title} subtitle={x.on ? `On now · ${x.percentOff}% off` : `${x.day} · ${x.percentOff}% off`} />
                ))}
              </List>
            </Section>
          ) : null}
          <Section title="Plan more deals">
            {d.max < d.min ? (
              <EmptyState heading="Not enough products" body="Publish at least two products to plan deals." />
            ) : (
              <Card>
                <Field label="First deal on (YYYY-MM-DD)" value={start} onChangeText={setStart} autoCapitalize="none" />
                <Field label="Price cut each day (%)" value={percent} onChangeText={setPercent} keyboardType="number-pad" />
                <Body muted>{`Tap products in the order they run, ${d.min} to ${d.max} days.`}</Body>
                <List>
                  {d.products.map((p) => {
                    const i = picked.indexOf(p.id);
                    return (
                      <Row
                        key={p.id}
                        title={p.title}
                        a11y={i >= 0 ? `${p.title}, day ${i + 1}` : p.title}
                        onPress={() => toggle(p.id)}
                        right={i >= 0 ? <Pill label={`Day ${i + 1}`} tone="info" /> : undefined}
                      />
                    );
                  })}
                </List>
                <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                  <Button label="Plan the deals" busy={busy} disabled={busy || picked.length < d.min} onPress={plan} />
                  {picked.length ? <Button label="Clear" kind="ghost" onPress={() => setPicked([])} disabled={busy} /> : null}
                </View>
              </Card>
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}
