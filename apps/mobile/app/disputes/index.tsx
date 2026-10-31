import { View } from "react-native";
import { useApi } from "../../src/api";
import { money, when } from "../../src/format";
import { useSession } from "../../src/session";
import { BackLink, Banner, EmptyState, List, LoadError, Loading, Pill, Row, Screen, Stat } from "../../src/ui";
import { DISPUTE_STATUS } from "../../src/disputes";

type Dispute = {
  id: string;
  orderId: string | null;
  orderNumber: number | null;
  email: string | null;
  status: keyof typeof DISPUTE_STATUS;
  inquiry: boolean;
  reason: string;
  amountMinor: number;
  currency: string;
  evidenceDueBy: string | null;
  createdAt: string;
};
type Data = { open: number; atStakeMinor: number; won: number; lost: number; rate: number; tooHigh: boolean; disputes: Dispute[] };

/** Payments a buyer's bank is pulling back: the ones to answer first, then the rest with how they ended. */
export default function DisputesScreen() {
  const cur = useSession().me?.shop.currency ?? "USD";
  const data = useApi<Data>("disputes");
  const d = data.data;
  return (
    <Screen title="Disputes" back={<BackLink href="/money" label="Money" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          {d.tooHigh ? (
            <Banner tone="warning">{`${(d.rate * 100).toFixed(2)}% of your orders in the last 90 days were disputed. Card networks start to worry at 0.75%, so answer each one and check what's causing them.`}</Banner>
          ) : null}
          {d.disputes.length ? (
            <View style={{ flexDirection: "row", gap: 1 }}>
              <Stat label="To answer" value={String(d.open)} />
              <Stat label="Held" value={money(d.atStakeMinor, cur)} />
              <Stat label="Won / lost" value={`${d.won} / ${d.lost}`} />
            </View>
          ) : null}
          {d.disputes.length === 0 ? (
            <EmptyState heading="No disputes" body="That's how it should be. If a buyer's bank pulls a payment back, it shows up here and on the order, with the evidence ready to send." />
          ) : (
            <List>
              {d.disputes.map((x) => {
                const s = DISPUTE_STATUS[x.status];
                return (
                  <Row
                    key={x.id}
                    href={x.orderId ? (`/orders/${x.orderId}` as never) : undefined}
                    a11y={x.orderNumber ? `Dispute on order #${x.orderNumber}` : "Dispute"}
                    title={`${x.orderNumber ? `Order #${x.orderNumber}` : "A payment"} · ${money(x.amountMinor, x.currency)}`}
                    subtitle={[
                      x.inquiry ? "A question from the buyer's bank" : x.reason,
                      x.status === "needs_response" && x.evidenceDueBy ? `Answer by ${when(x.evidenceDueBy)}` : `Opened ${when(x.createdAt)}`,
                    ].join("\n")}
                    right={<Pill label={s.label} tone={s.tone} />}
                  />
                );
              })}
            </List>
          )}
        </>
      )}
    </Screen>
  );
}
