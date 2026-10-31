import { useRouter } from "expo-router";
import { useState } from "react";
import { useApi } from "../../src/api";
import { money } from "../../src/format";
import { matches, MISSING, STATUS, type Product } from "../../src/product";
import { useCan, useSession } from "../../src/session";
import { Body, Button, EmptyState, Field, List, LoadError, Loading, Pill, Row, Screen, Segmented } from "../../src/ui";

export default function ProductsScreen() {
  const router = useRouter();
  const list = useApi<{ products: Product[]; priceRises?: number }>("products");
  const cur = useSession().me?.shop.currency ?? "USD";
  const can = useCan();
  const [show, setShow] = useState<"all" | "low" | "sold_out" | "missing">("all");
  const all = list.data?.products ?? [];
  // Archived products are off the store, so what they lack doesn't matter.
  const incomplete = all.filter((p) => p.status !== "archived" && p.missing.length > 0);
  const low = all.filter((p) => p.status === "active" && p.stockLevel === "low");
  const soldOut = all.filter((p) => p.status === "active" && p.stockLevel === "sold_out");
  const lists = { all, low, sold_out: soldOut, missing: incomplete };
  const [query, setQuery] = useState("");
  const products = lists[show].filter((p) => matches(p, query));
  // Only the lists with something in them, and the one already picked.
  const tabs = (
    [
      ["all", "All"],
      ["low", `Low (${low.length})`],
      ["sold_out", `Sold out (${soldOut.length})`],
      ["missing", `Needs details (${incomplete.length})`],
    ] as [keyof typeof lists, string][]
  ).filter(([k]) => k === "all" || k === show || lists[k].length > 0);
  return (
    <Screen title="Products" onRefresh={list.reload} refreshing={list.loading && !!list.data} right={<Button label="Import" onPress={() => router.push("/import")} a11y="Import from a supplier link" />}>
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!list.data ? (
        list.loading ? <Loading /> : null
      ) : all.length === 0 ? (
        <EmptyState heading="No products yet" body="Paste a link from your supplier, or share it to this app from the supplier's app or website." />
      ) : (
        <>
          <Field label="Search products" value={query} onChangeText={setQuery} placeholder="Name or SKU" autoCapitalize="none" />
          {query.trim() && products.length === 0 ? <Body muted>{`No products match "${query.trim()}".`}</Body> : null}
          {tabs.length > 1 ? <Segmented label="Which products" value={show} onChange={setShow} options={tabs} /> : null}
          {(show === "low" || show === "sold_out") && lists[show].length === 0 ? <Body muted>{show === "low" ? "Nothing on sale is running low." : "Nothing on sale is sold out."}</Body> : null}
          {show === "missing" ? (
            <Body muted>
              {incomplete.length
                ? "Weight is for shipping rates by weight, customs details for orders abroad, and cost for your profit on Money."
                : "Every product has a photo, description, weight, customs details and cost."}
            </Body>
          ) : null}
          <List>
            {products.map((p) => {
            const v = p.variants[0];
            const base = v ? `${money(v.priceMinor, cur)}${p.variants.length > 1 ? ` · ${p.variants.length} options` : ""}${v.stock !== null ? ` · ${v.stock} in stock` : ""}` : "No price yet";
            return (
              <Row
                key={p.id}
                href={`/products/${p.id}`}
                title={p.title}
                subtitle={show === "missing" ? p.missing.map((m) => MISSING[m]).join(" · ") : base}
                right={<Pill label={STATUS[p.status].label} tone={STATUS[p.status].tone} />}
              />
            );
          })}
          </List>
        </>
      )}
      <List>
        <Row href="/restock" title="Restock orders" subtitle="Stock you keep yourself, on the way from a supplier" />
        <Row href="/stock-count" title="Count stock" subtitle="Walk the shelves and set what's really there" />
        <Row
          href="/price-changes"
          title={list.data?.priceRises ? `Price changes (${list.data.priceRises} to look at)` : "Price changes"}
          subtitle="When a supplier starts charging more"
        />
        {can("suppliers") ? <Row href="/suppliers" title="Suppliers" subtitle="How each is doing, and your own wholesalers and makers" /> : null}
      </List>
    </Screen>
  );
}
