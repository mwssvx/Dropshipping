import { View } from "react-native";
import { useApi } from "../src/api";
import { money } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, EmptyState, List, LoadError, Loading, Pill, Row, Screen, Section, Stat } from "../src/ui";

type Data = {
  totals: { units: number; incoming: number; atCostMinor: number; atPriceMinor: number; missingCost: number };
  rows: { variantId: string; productId: string; title: string; sku: string | null; location: string | null; stock: number; incoming: number; sold: number; daysLeft: number | null; low: boolean; valueAtCostMinor: number | null }[];
};

const lasts = (d: number | null) => (d === null ? "" : d === 1 ? "lasts about 1 day" : `lasts about ${d} days`);

/**
 * The stock the store keeps itself, with what it's worth and how fast it sells: the options
 * that will run out soonest come first. Supplier products aren't here; they follow the supplier.
 */
export default function InventoryScreen() {
  const cur = useSession().me?.shop.currency ?? "USD";
  const data = useApi<Data>("inventory");
  const d = data.data;
  return (
    <Screen title="Inventory" back={<BackLink href="/products" label="Products" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : d.rows.length === 0 ? (
        <EmptyState heading="Nothing counted yet" body="Set a stock number on a product you keep yourself to see it here." />
      ) : (
        <>
          <List>
            <View style={{ flexDirection: "row", gap: 1 }}>
              <Stat label="In stock" value={d.totals.units.toLocaleString("en")} />
              <Stat label="On the way" value={d.totals.incoming.toLocaleString("en")} />
            </View>
            <View style={{ flexDirection: "row", gap: 1 }}>
              <Stat label="Worth at cost" value={money(d.totals.atCostMinor, cur)} />
              <Stat label="Worth at your prices" value={money(d.totals.atPriceMinor, cur)} />
            </View>
          </List>
          {d.totals.missingCost > 0 ? (
            <Banner tone="info">{`${d.totals.missingCost === 1 ? "1 option has" : `${d.totals.missingCost} options have`} no cost, so the worth at cost leaves ${d.totals.missingCost === 1 ? "it" : "them"} out. Add your cost on the product, or on a restock order.`}</Banner>
          ) : null}
          <Section title="Soonest to run out">
            <Body muted>How long each lasts is counted from what sold in the last 30 days.</Body>
            <List>
              {d.rows.map((r) => {
                const line = [`${r.stock} in stock`, r.incoming ? `${r.incoming} on the way` : "", `${r.sold} sold in 30 days`, lasts(r.daysLeft), r.location ? `shelf ${r.location}` : ""].filter(Boolean).join(" · ");
                const flag = r.stock === 0 ? "Sold out" : r.low ? "Running low" : null;
                return (
                  <Row
                    key={r.variantId}
                    href={`/products/${r.productId}` as never}
                    title={r.title}
                    subtitle={line}
                    right={flag ? <Pill label={flag} tone={r.stock === 0 ? "critical" : "warning"} /> : undefined}
                    a11y={`${r.title}${flag ? `, ${flag.toLowerCase()}` : ""}: ${line}`}
                  />
                );
              })}
            </List>
          </Section>
          <List>
            <Row href="/stock-count" title="Count stock" subtitle="Walk the shelves and set what's really there" />
            <Row href="/restock" title="Restock orders" subtitle="Order more from your supplier and count it in" />
          </List>
        </>
      )}
    </Screen>
  );
}
