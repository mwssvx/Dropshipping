import { useState } from "react";
import { api, useApi } from "../src/api";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen, Section, Segmented, Toggle } from "../src/ui";

type Phone = "off" | "optional" | "required";
type Data = { minOrderMinor: number; phone: Phone; protection: { percent: number; minMinor: number } | null };

const PHONE: Record<Phone, string> = { optional: "Ask for it, but buyers can leave it empty", required: "Buyers must enter one", off: "Don't ask" };

/** Checkout settings: the least a buyer can spend, asking for a phone number, and delivery protection. */
export default function CheckoutSettingsScreen() {
  const cur = useSession().me?.shop.currency ?? "USD";
  const data = useApi<Data>("checkout-settings");
  const [min, setMin] = useState<string | null>(null);
  const [phone, setPhone] = useState<Phone | null>(null);
  const [prot, setProt] = useState<{ on: boolean; percent: string; min: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const minV = min ?? (d?.minOrderMinor ? (d.minOrderMinor / 100).toFixed(2) : "");
  const phoneV = phone ?? d?.phone ?? "optional";
  const protV = prot ?? (d ? { on: !!d.protection, percent: String(d.protection?.percent ?? 3), min: ((d.protection?.minMinor ?? 100) / 100).toFixed(2) } : null);

  async function run(key: string, path: string, body: unknown, after: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { method: "PUT", body });
      setNote({ tone: "success", text: r.message });
      after();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Checkout" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !protV ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Smallest order">
            <Card>
              <Body muted>A very small order can cost more to pack and send than it earns. The cart asks buyers under this amount to add a little more. Gift cards on their own, wholesale orders and payment links aren't held to it.</Body>
              <Field label={`Smallest order (${cur})`} value={minV} onChangeText={setMin} keyboardType="decimal-pad" placeholder="15.00" hint="Leave it empty to take any amount." />
              <Button label="Save smallest order" busy={busy === "min"} disabled={!!busy || min === null} onPress={() => run("min", "checkout-settings/min-order", { min: minV }, () => setMin(null))} />
            </Card>
          </Section>
          <Section title="Phone number at checkout">
            <Card>
              <Body muted>Couriers call or text when they can't find an address, and some carriers need a number to deliver at all. It goes to your supplier with the order and is never used for marketing.</Body>
              <Segmented
                label="Ask for a phone number"
                value={phoneV}
                onChange={setPhone}
                options={[
                  ["optional", "Optional"],
                  ["required", "Required"],
                  ["off", "Don't ask"],
                ]}
              />
              <Body>{PHONE[phoneV]}</Body>
              <Button label="Save phone number" busy={busy === "phone"} disabled={!!busy || phone === null} onPress={() => run("phone", "checkout-settings/phone", { mode: phoneV }, () => setPhone(null))} />
            </Card>
          </Section>
          <Section title="Delivery protection">
            <Card>
              <Body muted>Buyers can pay a little extra to protect their parcel. If a protected order is lost or arrives damaged, send a replacement for free from the order. What they pay is yours, and it's never ticked for them.</Body>
              <Toggle label="Offer delivery protection" value={protV.on} onChange={(v) => setProt({ ...protV, on: v })} />
              {protV.on ? (
                <>
                  <Field label="Price, % of the order" value={protV.percent} onChangeText={(v) => setProt({ ...protV, percent: v })} keyboardType="decimal-pad" />
                  <Field label={`Lowest price (${cur})`} value={protV.min} onChangeText={(v) => setProt({ ...protV, min: v })} keyboardType="decimal-pad" />
                </>
              ) : null}
              <Button label="Save delivery protection" busy={busy === "prot"} disabled={!!busy || prot === null} onPress={() => run("prot", "checkout-settings/protection", protV, () => setProt(null))} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
