import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useApi } from "../../src/api";
import { FULFILMENT, money, PAYMENT, when } from "../../src/format";
import { EmptyState, List, LoadError, Loading, Pill, Row, Screen, Segmented } from "../../src/ui";

type Order = { id: string; number: number; name: string; email: string; totalMinor: number; currency: string; paymentStatus: string; fulfillmentStatus: string; paidAt: string | null; createdAt: string };
type Show = "open" | "problems" | "all";

const EMPTY: Record<Show, [string, string]> = {
  open: ["No open orders", "Paid orders that haven't shipped yet show up here."],
  problems: ["No problems", "Orders the supplier couldn't take show up here, each with a fix."],
  all: ["No orders yet", "Share your store link to get your first sale."],
};

export default function OrdersScreen() {
  const params = useLocalSearchParams<{ show?: string }>();
  const [show, setShow] = useState<Show>(params.show === "problems" ? "problems" : params.show === "all" ? "all" : "open");
  const list = useApi<{ orders: Order[] }>(`orders?show=${show}`);
  const orders = list.data?.orders ?? [];

  return (
    <Screen title="Orders" onRefresh={list.reload} refreshing={list.loading && !!list.data}>
      <Segmented
        label="Which orders"
        value={show}
        onChange={setShow}
        options={[
          ["open", "Open"],
          ["problems", "Needs you"],
          ["all", "All"],
        ]}
      />
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!list.data ? (
        list.loading ? <Loading /> : null
      ) : orders.length === 0 ? (
        <EmptyState heading={EMPTY[show][0]} body={EMPTY[show][1]} />
      ) : (
        <List>
          {orders.map((o) => {
            const f = FULFILMENT[o.fulfillmentStatus] ?? { label: o.fulfillmentStatus, tone: "neutral" as const };
            const refunded = o.paymentStatus === "refunded" || o.paymentStatus === "partially_refunded";
            return (
              <Row
                key={o.id}
                href={`/orders/${o.id}`}
                a11y={`Order #${o.number}`}
                title={`#${o.number} · ${o.name}`}
                subtitle={`${money(o.totalMinor, o.currency)} · ${when(o.paidAt ?? o.createdAt)}${refunded ? ` · ${PAYMENT[o.paymentStatus]}` : ""}`}
                right={<Pill label={o.paymentStatus === "pending" ? "Not paid" : f.label} tone={o.paymentStatus === "pending" ? "neutral" : f.tone} />}
              />
            );
          })}
        </List>
      )}
    </Screen>
  );
}
