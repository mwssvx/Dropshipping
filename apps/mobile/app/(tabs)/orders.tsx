import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useApi } from "../../src/api";
import { FULFILMENT, money, PAYMENT, when } from "../../src/format";
import { EmptyState, Field, List, LoadError, Loading, Pill, Row, Screen, Segmented } from "../../src/ui";

type Order = { id: string; number: number; name: string; email: string; totalMinor: number; currency: string; paymentStatus: string; fulfillmentStatus: string; held?: boolean; paidAt: string | null; createdAt: string; daysLate?: number };
type Show = "open" | "to_post" | "problems" | "late" | "all";

const EMPTY: Record<Show, [string, string]> = {
  open: ["No open orders", "Paid orders that haven't shipped yet show up here."],
  to_post: ["Nothing to post", "Orders with your own stock in them show up here until you add their tracking, oldest first."],
  problems: ["No problems", "Orders the supplier couldn't take, and orders held for a risk check, show up here."],
  late: ["Nothing late", "Shipped parcels that are past their delivery date show up here, so you can check on them before the buyer asks."],
  all: ["No orders yet", "Share your store link to get your first sale."],
};

export default function OrdersScreen() {
  const params = useLocalSearchParams<{ show?: string }>();
  const [show, setShow] = useState<Show>(params.show === "problems" || params.show === "held" ? "problems" : params.show === "all" ? "all" : params.show === "late" ? "late" : params.show === "to_post" ? "to_post" : "open");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  // Waits for a pause in typing before asking the server.
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const list = useApi<{ orders: Order[] }>(q ? `orders?q=${encodeURIComponent(q)}` : `orders?show=${show}`);
  const orders = list.data?.orders ?? [];

  return (
    <Screen title="Orders" onRefresh={list.reload} refreshing={list.loading && !!list.data}>
      <Field label="Search orders" value={query} onChangeText={setQuery} placeholder="Order number, name or email" autoCapitalize="none" />
      {q ? null : (
        <Segmented
          label="Which orders"
          value={show}
          onChange={setShow}
          options={[
            ["open", "Open"],
            ["to_post", "To post"],
            ["problems", "Needs you"],
            ["late", "Late"],
            ["all", "All"],
          ]}
        />
      )}
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!list.data ? (
        list.loading ? <Loading /> : null
      ) : orders.length === 0 ? (
        q ? (
          <EmptyState heading="No order matches" body={`No order's number, name or email has "${q}" in it.`} />
        ) : (
          <EmptyState heading={EMPTY[show][0]} body={EMPTY[show][1]} />
        )
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
                right={o.daysLate ? <Pill label={`${o.daysLate} ${o.daysLate === 1 ? "day" : "days"} late`} tone="warning" /> : o.held ? <Pill label="On hold" tone="warning" /> : <Pill label={o.paymentStatus === "pending" ? "Not paid" : f.label} tone={o.paymentStatus === "pending" ? "neutral" : f.tone} />}
              />
            );
          })}
        </List>
      )}
    </Screen>
  );
}
