import { useState } from "react";
import { api, useApi } from "../src/api";
import { useCan } from "../src/session";
import { BackLink, Banner, Body, Button, Card, LoadError, Loading, Screen, Section, Segmented, Toggle } from "../src/ui";

type Hold = "high" | "medium" | "off";
type Data = { hold: Hold; holdOptions: { value: Hold; label: string }[]; buyerCancel: boolean | null; cancelHours: number };

const SHORT: Record<Hold, string> = { high: "High risk", medium: "Medium and high", off: "Never" };

/** Which risky orders wait for the owner before going to the supplier, and whether buyers can cancel their own orders. */
export default function OrderSettingsScreen() {
  const data = useApi<Data>("order-settings");
  const can = useCan();
  const [hold, setHold] = useState<Hold | null>(null);
  const [cancel, setCancel] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const h = hold ?? d?.hold ?? "high";
  const c = cancel ?? d?.buyerCancel ?? false;

  async function save(key: string, path: string, body: unknown, after: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const res = await api<{ message: string }>(path, { method: "PUT", body });
      setNote({ tone: "success", text: res.message });
      after();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Order settings" back={<BackLink href="/orders" label="Orders" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Risk check">
            <Card>
              <Body muted>Every paid order is checked for signs of a stolen card, like a throwaway email, several declined cards or an address many buyers ship to. A held order waits for you before it goes to the supplier, so you can refund it before you've paid for the goods.</Body>
              <Segmented label="Hold risky orders" value={h} onChange={(v) => setHold(v as Hold)} options={d.holdOptions.map((o) => [o.value, SHORT[o.value]] as [string, string])} />
              <Body>{d.holdOptions.find((o) => o.value === h)?.label ?? ""}</Body>
              <Button label="Save risk check" busy={busy === "risk"} disabled={!!busy || hold === null || hold === d.hold} onPress={() => void save("risk", "order-settings/risk", { hold: h }, () => setHold(null))} />
            </Card>
          </Section>
          {d.buyerCancel !== null && can("refunds") ? (
            <Section title="Buyer cancellations">
              <Card>
                <Toggle label={`Let buyers cancel in the first ${d.cancelHours} hours`} value={c} onChange={setCancel} />
                <Body muted>From their order page, before it ships. Supplier orders are stopped and the buyer is refunded in full.</Body>
                <Button label="Save buyer cancellations" busy={busy === "cancel"} disabled={!!busy || cancel === null || cancel === d.buyerCancel} onPress={() => void save("cancel", "order-settings/buyer-cancel", { on: c }, () => setCancel(null))} />
              </Card>
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}
