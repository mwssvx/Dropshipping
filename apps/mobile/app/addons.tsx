import { useState } from "react";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, List, LoadError, Loading, Pill, Row, Screen, Section, Toggle } from "../src/ui";

type Choice = { id: string; title: string };
type Data = {
  currency: string;
  max: number;
  addons: { id: string; title: string; percentOff: number; pitch: string | null; bought: number; revenueMinor: number; live: boolean; active: boolean }[];
  products: Choice[];
  gifts: Choice[];
  freeGift: { variantId: string; min: string } | null;
  tipping: { percents: number[]; note: string | null } | null;
};

/** Search a list and tap one; the picked one shows with a way to pick again. */
function Picker({ label, choices, value, onChange }: { label: string; choices: Choice[]; value: string | null; onChange: (id: string | null) => void }) {
  const [find, setFind] = useState("");
  const picked = choices.find((c) => c.id === value);
  if (picked)
    return (
      <List>
        <Row title={picked.title} subtitle="Tap to pick another" onPress={() => onChange(null)} a11y={`${label}: ${picked.title}. Pick another`} />
      </List>
    );
  const q = find.trim().toLowerCase();
  const shown = (q ? choices.filter((c) => c.title.toLowerCase().includes(q)) : choices).slice(0, 5);
  return (
    <>
      <Field label={label} value={find} onChangeText={setFind} placeholder="Search your products" autoCapitalize="none" />
      <List>
        {shown.map((c) => (
          <Row key={c.id} title={c.title} onPress={() => onChange(c.id)} a11y={`Pick ${c.title}`} />
        ))}
      </List>
    </>
  );
}

/** Checkout extras: add-ons offered for a little less, a free gift with bigger orders, and tips. */
export default function AddonsScreen() {
  const data = useApi<Data>("addons");
  const [addon, setAddon] = useState<{ productId: string | null; percentOff: string; pitch: string }>({ productId: null, percentOff: "10", pitch: "" });
  const [gift, setGift] = useState<{ on: boolean; variantId: string | null; min: string } | null>(null);
  const [tips, setTips] = useState<{ on: boolean; percents: string; note: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const g = gift ?? (d ? { on: !!d.freeGift, variantId: d.freeGift?.variantId ?? null, min: d.freeGift?.min ?? "" } : null);
  const t = tips ?? (d ? { on: !!d.tipping, percents: (d.tipping?.percents ?? [10, 15, 20]).join(", "), note: d.tipping?.note ?? "" } : null);

  async function run(key: string, path: string, method: "POST" | "PUT" | "DELETE", body?: unknown, after?: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { method, body });
      setNote({ tone: "success", text: r.message });
      after?.();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Checkout extras" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !g || !t ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title={`Add-ons (${d.addons.length} of ${d.max})`}>
            <Body muted>Offer one more product at checkout, for a little less, added with one tap. Buyers see the first add-on that isn't already in their cart. Wholesale buyers don't see add-ons.</Body>
            {d.addons.length === 0 ? (
              <EmptyState heading="No add-ons yet" body="Pick a product below to offer it at checkout." />
            ) : (
              <List>
                {d.addons.map((a) => (
                  <Row
                    key={a.id}
                    title={`${a.title} · ${a.percentOff ? `${a.percentOff}% off` : "full price"}`}
                    subtitle={`${a.pitch ? `${a.pitch} · ` : ""}bought on ${a.bought} ${a.bought === 1 ? "order" : "orders"}, ${money(a.revenueMinor, d.currency)}`}
                    right={<Pill label={a.live ? "At checkout" : a.active ? "Product not on sale" : "Off"} tone={a.live ? "success" : a.active ? "warning" : "neutral"} />}
                  />
                ))}
              </List>
            )}
            {d.addons.map((a) => (
              <Card key={a.id}>
                <Body>{a.title}</Body>
                <Button
                  label={a.active ? "Turn off" : "Turn on"}
                  kind="secondary"
                  a11y={`${a.active ? "Turn off" : "Turn on"} ${a.title}`}
                  busy={busy === `toggle-${a.id}`}
                  disabled={!!busy}
                  onPress={() => void run(`toggle-${a.id}`, `addons/${a.id}`, "PUT", { active: !a.active })}
                />
                <Button label="Delete" kind="ghost" a11y={`Delete ${a.title}`} busy={busy === `delete-${a.id}`} disabled={!!busy} onPress={() => void run(`delete-${a.id}`, `addons/${a.id}`, "DELETE")} />
              </Card>
            ))}
            {d.addons.length < d.max && d.products.length ? (
              <Card>
                <Picker label="Product to offer" choices={d.products} value={addon.productId} onChange={(id) => setAddon({ ...addon, productId: id })} />
                <Field label="Discount (%)" value={addon.percentOff} onChangeText={(v) => setAddon({ ...addon, percentOff: v })} keyboardType="number-pad" />
                <Field label="One line for buyers (optional)" value={addon.pitch} onChangeText={(v) => setAddon({ ...addon, pitch: v })} placeholder="Keeps your phone up while it charges" />
                <Button
                  label="Add add-on"
                  busy={busy === "add"}
                  disabled={!!busy || !addon.productId}
                  onPress={() => void run("add", "addons", "POST", addon, () => setAddon({ productId: null, percentOff: "10", pitch: "" }))}
                />
              </Card>
            ) : null}
          </Section>

          <Section title="Free gift">
            <Card>
              <Body muted>Give something away with orders over an amount. The cart tells buyers how much more it takes, and the gift is added for free once they get there. Wholesale orders don't get one.</Body>
              <Toggle label="Give a free gift with bigger orders" value={g.on} onChange={(v) => setGift({ ...g, on: v })} />
              {g.on ? (
                <>
                  <Picker label="Gift to give" choices={d.gifts} value={g.variantId} onChange={(id) => setGift({ ...g, variantId: id })} />
                  <Field label={`For orders over (${d.currency})`} value={g.min} onChangeText={(v) => setGift({ ...g, min: v })} keyboardType="decimal-pad" placeholder="75.00" />
                </>
              ) : null}
              <Button label="Save free gift" busy={busy === "gift"} disabled={!!busy || !gift} onPress={() => void run("gift", "free-gift", "PUT", g, () => setGift(null))} />
            </Card>
          </Section>

          <Section title="Tips">
            <Card>
              <Body muted>Let buyers add a tip for you at checkout, as a percentage of what they're buying. "No tip" is always first and picked. No tax is added and we take no fee on it.</Body>
              <Toggle label="Ask for a tip at checkout" value={t.on} onChange={(v) => setTips({ ...t, on: v })} />
              {t.on ? (
                <>
                  <Field label="Tip choices (% of the order)" value={t.percents} onChangeText={(v) => setTips({ ...t, percents: v })} hint="Split by commas: 10, 15, 20." />
                  <Field label="Thank-you line (optional)" value={t.note} onChangeText={(v) => setTips({ ...t, note: v })} placeholder="Every order is packed by hand. Thank you!" />
                </>
              ) : null}
              <Button label="Save tips" busy={busy === "tips"} disabled={!!busy || !tips} onPress={() => void run("tips", "tips", "PUT", t, () => setTips(null))} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
