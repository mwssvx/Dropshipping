import { useState } from "react";
import { Linking, View } from "react-native";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, Heading, LoadError, Loading, Pill, Screen, Section } from "../src/ui";
import { space } from "../src/theme";

type PlanId = string;
type Data = {
  current: PlanId;
  advice: { orders: number; salesMinor: number; feesMinor: number; currentCostMinor: number; best: { plan: PlanId; saveMinor: number } | null; overLimit: boolean; nearLimit: boolean; upgradeHint: string | null };
  plans: { id: PlanId; name: string; monthlyMinor: number; feeBps: number; blurb: string; ordersPerMonth: number | null; estimateMinor: number }[];
  testMode: boolean;
};

/**
 * The store's plan: what it cost over the last 30 days, the one that would have cost least for the
 * same sales, and switching. No contracts; a plan that needs a card is paid for in the browser.
 */
export default function PlanScreen() {
  const cur = useSession().me?.shop.currency ?? "USD";
  const data = useApi<Data>("plan");
  const [confirm, setConfirm] = useState<PlanId | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical" | "info"; text: string } | null>(null);
  const d = data.data;
  const current = d?.plans.find((p) => p.id === d.current);

  async function choose(plan: PlanId) {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ url: string | null; message: string }>("plan", { body: { plan } });
      setConfirm(null);
      if (r.url) {
        setNote({ tone: "info", text: r.message });
        await Linking.openURL(r.url);
      } else {
        setNote({ tone: "success", text: r.message });
        await data.reload();
      }
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Plan" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !current ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title={`You're on ${current.name}`}>
            <Card>
              <Body>
                {`Last 30 days: ${d.advice.orders === 1 ? "1 order" : `${d.advice.orders} orders`}, ${money(d.advice.salesMinor, cur)} in sales. This plan cost you ${money(d.advice.currentCostMinor, cur)}${current.feeBps ? ` (${money(d.advice.feesMinor, cur)} in sales fees${current.monthlyMinor ? ` plus ${money(current.monthlyMinor, "USD")}` : ""})` : ""}.`}
              </Body>
              {d.advice.upgradeHint ? <Body>{d.advice.upgradeHint}</Body> : null}
              {d.advice.best ? <Banner tone="info">{`${d.plans.find((p) => p.id === d.advice.best!.plan)?.name} would have cost ${money(d.advice.best.saveMinor, cur)} less for the same sales.`}</Banner> : null}
              {d.advice.overLimit ? <Banner tone="warning">{`More orders came in than ${current.name} includes. Pick a bigger plan to keep taking every order.`}</Banner> : null}
              <Body muted>No contracts. Switch or cancel any time; we never take a cut on paid plans. Card processing is charged by Stripe on every plan.</Body>
            </Card>
          </Section>
          <Section title="Plans">
            {d.plans.map((p) => {
              const isCurrent = p.id === d.current;
              const verb = p.monthlyMinor > current.monthlyMinor ? "Upgrade to" : "Switch to";
              return (
                <Card key={p.id}>
                  <View role="group" aria-label={p.name} style={{ gap: space(1) }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                      <Heading>{`${p.name} · ${money(p.monthlyMinor, "USD")} a month`}</Heading>
                      {isCurrent ? <Pill label="Current" tone="info" /> : d.advice.best?.plan === p.id ? <Pill label="Costs least" tone="success" /> : null}
                    </View>
                    <Body>{`${p.feeBps ? `${p.feeBps / 100}% of each sale` : "0% of your sales"} · ${p.ordersPerMonth ? `up to ${p.ordersPerMonth} orders a month` : "unlimited orders"}`}</Body>
                    <Body muted>{p.blurb}</Body>
                    <Body>{`With your last 30 days: ${money(p.estimateMinor, cur)}`}</Body>
                    {isCurrent ? null : confirm === p.id ? (
                      <Button label={`${verb} ${p.name} now`} busy={busy} disabled={busy} onPress={() => choose(p.id)} />
                    ) : (
                      <Button label={`${verb} ${p.name}…`} kind={d.advice.best?.plan === p.id ? "primary" : "secondary"} disabled={busy} onPress={() => setConfirm(p.id)} />
                    )}
                  </View>
                </Card>
              );
            })}
          </Section>
          {d.testMode ? <Body muted>Test mode: plan changes apply straight away and nothing is charged.</Body> : null}
        </>
      )}
    </Screen>
  );
}
