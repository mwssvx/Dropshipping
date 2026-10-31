import { useState } from "react";
import { api, useApi } from "../src/api";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen, Section, Segmented, Toggle } from "../src/ui";

type Data = {
  welcome: { percentOff: number; minSubtotalMinor: number; days: number } | null;
  welcomeText: string | null;
  popupSeconds: number | null;
  popupOptions: number[];
  onLeave: number;
};

/**
 * New subscribers: the code they get by email when they sign up, and the pop-up that asks new
 * visitors for their email. It opens once, never on the cart or checkout.
 */
export default function SignupScreen() {
  const data = useApi<Data>("signup");
  const cur = useSession().me?.shop.currency ?? "USD";
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const savedWelcome = d
    ? { on: !!d.welcome, percentOff: String(d.welcome?.percentOff ?? 10), minSubtotal: d.welcome?.minSubtotalMinor ? (d.welcome.minSubtotalMinor / 100).toFixed(2) : "", days: String(d.welcome?.days ?? 30) }
    : null;
  const [welcome, setWelcome] = useState<NonNullable<typeof savedWelcome> | null>(null);
  const w = welcome ?? savedWelcome;
  const savedPopup = d ? { on: d.popupSeconds !== null, when: String(d.popupSeconds ?? d.onLeave) } : null;
  const [popup, setPopup] = useState<NonNullable<typeof savedPopup> | null>(null);
  const p = popup ?? savedPopup;

  async function save(key: "welcome" | "popup", body: unknown, done: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(`signup/${key}`, { method: "PUT", body });
      setNote({ tone: "success", text: r.message });
      done();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="New subscribers" back={<BackLink href="/codes" label="Discount codes" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !w || !p ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Welcome offer">
            <Card>
              <Body muted>Someone who signs up to your emails gets their own code, good once, for their email only.</Body>
              <Toggle label="Give new subscribers a code" value={w.on} onChange={(v) => setWelcome({ ...w, on: v })} />
              {w.on ? (
                <>
                  <Field label="Percent off (%)" value={w.percentOff} onChangeText={(v) => setWelcome({ ...w, percentOff: v })} keyboardType="number-pad" hint="5% to 50%." />
                  <Field label={`Smallest order (${cur}, optional)`} value={w.minSubtotal} onChangeText={(v) => setWelcome({ ...w, minSubtotal: v })} keyboardType="decimal-pad" hint="Leave empty for any order." />
                  <Field label="Code lasts (days)" value={w.days} onChangeText={(v) => setWelcome({ ...w, days: v })} keyboardType="number-pad" hint="7 to 90 days." />
                </>
              ) : null}
              <Button label="Save welcome offer" busy={busy === "welcome"} disabled={!!busy || !welcome} onPress={() => save("welcome", w, () => setWelcome(null))} />
            </Card>
          </Section>
          <Section title="Sign-up pop-up">
            <Card>
              <Body muted>{d.welcomeText ? `A small window asks new visitors for their email, offering ${d.welcomeText}.` : "A small window asks new visitors for their email."} It shows once, and never on the cart or checkout.</Body>
              <Toggle label="Ask new visitors for their email" value={p.on} onChange={(v) => setPopup({ ...p, on: v })} />
              {p.on ? (
                <Segmented
                  label="When it opens"
                  value={p.when}
                  onChange={(v) => setPopup({ ...p, when: v })}
                  options={d.popupOptions.map((n) => [String(n), n === d.onLeave ? "About to leave" : `${n} s`] as [string, string])}
                />
              ) : null}
              <Button label="Save pop-up" busy={busy === "popup"} disabled={!!busy || !popup} onPress={() => save("popup", { seconds: p.on ? Number(p.when) : null }, () => setPopup(null))} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
