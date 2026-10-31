import { useRouter } from "expo-router";
import { useApi } from "../../src/api";
import { money, when } from "../../src/format";
import { useSession } from "../../src/session";
import { RESTOCK_STATUS } from "../../src/restock";
import { BackLink, Body, Button, EmptyState, List, LoadError, Loading, Pill, Row, Screen } from "../../src/ui";

type Restock = { id: string; number: number; supplierName: string; status: "open" | "received" | "cancelled"; expectedOn: string | null; createdAt: string; lines: number; ordered: number; received: number; costMinor: number };

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Stock the store keeps itself, ordered from a supplier: what's on the way and what arrived. */
export default function RestockScreen() {
  const router = useRouter();
  const cur = useSession().me?.shop.currency ?? "USD";
  const list = useApi<{ orders: Restock[] }>("restock");
  const rows = list.data?.orders;
  return (
    <Screen title="Restock orders" back={<BackLink href="/products" label="Products" />} onRefresh={list.reload} refreshing={list.loading && !!rows}>
      <Body muted>For the stock you keep yourself. Count a delivery in when it arrives and the stock goes up.</Body>
      <Button label="New restock order" onPress={() => router.push("/restock/new")} />
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!rows ? (
        list.loading ? <Loading /> : null
      ) : rows.length === 0 ? (
        <EmptyState heading="No restock orders yet" body="When you order more of your own stock from a supplier, write it down here and count it in when it arrives." />
      ) : (
        <List>
          {rows.map((o) => {
            const [label, tone] = RESTOCK_STATUS[o.status];
            return (
              <Row
                key={o.id}
                href={`/restock/${o.id}` as never}
                a11y={`Restock order #${o.number}`}
                title={`#${o.number} · ${o.supplierName}`}
                subtitle={[
                  `${o.received} of ${o.ordered} in${o.costMinor ? ` · ${money(o.costMinor, cur)}` : ""}`,
                  o.status === "open" && o.expectedOn ? `Expected ${day.format(new Date(`${o.expectedOn}T12:00:00Z`))}` : `Made ${when(o.createdAt)}`,
                ].join("\n")}
                right={<Pill label={label} tone={tone} />}
              />
            );
          })}
        </List>
      )}
    </Screen>
  );
}
