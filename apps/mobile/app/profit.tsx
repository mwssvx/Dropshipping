import { useState } from "react";
import { api, useApi } from "../src/api";
import { money, parseMoney } from "../src/format";
import { color } from "../src/theme";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, List, LoadError, Loading, Pill, Row, Screen, Section, Segmented } from "../src/ui";

type Line = {
  productId: string | null;
  title: string;
  units: number;
  salesMinor: number;
  refundsMinor: number;
  costMinor: number;
  feesMinor: number;
  adsMinor: number;
  profitMinor: number;
  marginPercent: number | null;
  roas: number | null;
  breakEvenRoas: number | null;
  costMissing: boolean;
};
type Data = {
  currency: string;
  days: number;
  from: string;
  to: string;
  orders: number;
  totals: Line;
  products: Line[];
  untiedAdsMinor: number;
  adsByChannel: { channel: string; label: string; amountMinor: number }[];
  giftCardSalesMinor: number;
  ads: { id: string; day: string; channel: string; note: string | null; amountMinor: number; product: string | null }[];
  channels: { value: string; label: string }[];
  choices: { id: string; title: string }[];
};
type Range = "7" | "30" | "90";

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtDay = (d: string) => day.format(new Date(`${d}T12:00:00Z`));
const isoToday = () => new Date().toISOString().slice(0, 10);

/** The profit report: what's left after supplier costs, fees and ads, per product, with the ad spend entered. */
export default function ProfitScreen() {
  const [days, setDays] = useState<Range>("30");
  const data = useApi<Data>(`money/profit?days=${days}`);
  const [channel, setChannel] = useState("meta");
  const [spendDay, setSpendDay] = useState(isoToday);
  const [amount, setAmount] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [adNote, setAdNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const m = (minor: number) => money(minor, d?.currency ?? "USD");
  const t = d?.totals;
  const picked = d?.choices.find((p) => p.id === productId) ?? null;
  const q = find.trim().toLowerCase();
  const matches = q && d ? d.choices.filter((p) => p.title.toLowerCase().includes(q)).slice(0, 5) : [];

  async function act(key: string, run: () => Promise<{ message: string }>, after?: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await run();
      setNote({ tone: "success", text: r.message });
      after?.();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function addSpend() {
    const amountMinor = parseMoney(amount);
    if (amountMinor === null || amountMinor <= 0) {
      setNote({ tone: "critical", text: "Enter how much you spent, like 25.00." });
      return;
    }
    void act(
      "add",
      () => api("money/ad-spend", { method: "POST", body: { day: spendDay.trim(), channel, amountMinor, productId, note: adNote } }),
      () => {
        setAmount("");
        setAdNote("");
      },
    );
  }

  return (
    <Screen title="Profit" back={<BackLink href="/money" label="Money" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <Segmented
        label="Period"
        value={days}
        onChange={setDays}
        options={[
          ["7", "7 days"],
          ["30", "30 days"],
          ["90", "90 days"],
        ]}
      />
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !t ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Totals">
            <Body muted>{`${fmtDay(d.from)} to ${fmtDay(d.to)}, ${d.orders === 1 ? "1 order" : `${d.orders} orders`}`}</Body>
            <List>
              <Row title="Sales" subtitle="After discounts and refunds" right={<Body>{m(t.salesMinor - t.refundsMinor)}</Body>} />
              <Row title="Supplier costs" subtitle="Orders the supplier accepted" right={<Body>−{m(t.costMinor)}</Body>} />
              <Row title="Fees" subtitle="Card processing and our fee" right={<Body>−{m(t.feesMinor)}</Body>} />
              <Row title="Ads" subtitle={t.roas ? `Return on ad spend ${t.roas}×` : "Enter spend below"} right={<Body>−{m(t.adsMinor)}</Body>} />
              <Row
                title="Profit"
                subtitle={t.marginPercent != null ? `${t.marginPercent}% of sales` : "No sales yet"}
                right={<Body style={t.profitMinor < 0 ? { color: color.critical } : undefined}>{m(t.profitMinor)}</Body>}
              />
              <Row title="Break-even ROAS" subtitle={t.breakEvenRoas ? "Ads below this lose money" : "Needs a profitable sale"} right={<Body>{t.breakEvenRoas ? `${t.breakEvenRoas}×` : "—"}</Body>} />
            </List>
            {t.costMissing ? (
              <Banner tone="warning">Some products have no cost, so their profit looks higher than it is. Add what they cost you on each product.</Banner>
            ) : null}
          </Section>

          <Section title="By product">
            {d.products.length === 0 ? (
              <EmptyState heading="No paid orders in this period yet" body="Each product's profit shows here once it sells." />
            ) : (
              <List>
                {d.products.map((p) => {
                  const losing = p.roas != null && p.breakEvenRoas != null && p.roas < p.breakEvenRoas;
                  const bits = [`${p.units} sold`, `sales ${m(p.salesMinor - p.refundsMinor)}`];
                  if (p.roas != null) bits.push(`ROAS ${p.roas}×${p.breakEvenRoas != null ? ` (break-even ${p.breakEvenRoas}×)` : ""}`);
                  else if (p.breakEvenRoas != null) bits.push(`break-even ROAS ${p.breakEvenRoas}×`);
                  return (
                    <Row
                      key={p.productId ?? p.title}
                      title={p.title}
                      subtitle={bits.join(" · ")}
                      href={p.productId ? `/products/${p.productId}` : undefined}
                      a11y={`${p.title}, profit ${m(p.profitMinor)}${losing ? ", losing money on ads" : ""}${p.costMissing ? ", no cost" : ""}`}
                      right={
                        p.costMissing ? (
                          <Pill label="No cost" tone="warning" />
                        ) : (
                          <Body style={p.profitMinor < 0 || losing ? { color: color.critical } : undefined}>{m(p.profitMinor)}</Body>
                        )
                      }
                    />
                  );
                })}
                {d.untiedAdsMinor > 0 ? <Row title="Ads for the whole store" right={<Body style={{ color: color.critical }}>−{m(d.untiedAdsMinor)}</Body>} /> : null}
              </List>
            )}
            <Body muted>
              {`ROAS is sales after refunds for each unit spent on ads. Break-even is the ROAS where ads use up all the profit: below it, a product loses money on ads.${
                d.giftCardSalesMinor > 0 ? ` Gift cards sold (${m(d.giftCardSalesMinor)}) count when they're spent, not when they're bought.` : ""
              }`}
            </Body>
          </Section>

          <Section title="Ad spend">
            <Card>
              <Body muted>Enter what you spent on ads each day, from your ads dashboard. Pick a product to see its profit after ads, or leave it for the whole store.</Body>
              <Segmented label="Where the ads ran" value={channel} onChange={setChannel} options={d.channels.map((c) => [c.value, c.label] as [string, string])} />
              <Field label="Day (YYYY-MM-DD)" value={spendDay} onChangeText={setSpendDay} autoCapitalize="none" />
              <Field label={`Amount spent (${d.currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="25.00" />
              {picked ? (
                <List>
                  <Row title={`For ${picked.title}`} subtitle="Tap to spend it on the whole store instead" onPress={() => setProductId(null)} a11y={`For ${picked.title}. Change to the whole store`} />
                </List>
              ) : (
                <>
                  <Field label="For a product (optional)" value={find} onChangeText={setFind} placeholder="Search your products" autoCapitalize="none" hint="Leave it empty for the whole store." />
                  {matches.length ? (
                    <List>
                      {matches.map((p) => (
                        <Row
                          key={p.id}
                          title={p.title}
                          onPress={() => {
                            setProductId(p.id);
                            setFind("");
                          }}
                          a11y={`Spend on ${p.title}`}
                        />
                      ))}
                    </List>
                  ) : null}
                </>
              )}
              <Field label="Note (optional)" value={adNote} onChangeText={setAdNote} placeholder="Black Friday campaign" />
              <Button label="Add ad spend" busy={busy === "add"} disabled={!!busy} onPress={addSpend} />
            </Card>
            {d.adsByChannel.length > 1 ? <Body muted>{d.adsByChannel.map((c) => `${c.label} ${m(c.amountMinor)}`).join(" · ")}</Body> : null}
            {d.ads.length ? (
              <List>
                {d.ads.map((a) => (
                  <Row
                    key={a.id}
                    title={`${fmtDay(a.day)} · ${m(a.amountMinor)}`}
                    subtitle={[a.channel, a.product ?? "Whole store", a.note].filter(Boolean).join(" · ")}
                    right={
                      <Button
                        label="Remove"
                        kind="ghost"
                        a11y={`Remove ${m(a.amountMinor)} on ${fmtDay(a.day)}`}
                        busy={busy === a.id}
                        disabled={!!busy}
                        onPress={() => void act(a.id, () => api(`money/ad-spend/${a.id}`, { method: "DELETE" }))}
                      />
                    }
                  />
                ))}
              </List>
            ) : null}
          </Section>
        </>
      )}
    </Screen>
  );
}
