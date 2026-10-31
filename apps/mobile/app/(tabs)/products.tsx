import { useRouter } from "expo-router";
import { useState } from "react";
import { useApi } from "../../src/api";
import { money } from "../../src/format";
import { MISSING, STATUS, type Product } from "../../src/product";
import { useSession } from "../../src/session";
import { Body, Button, EmptyState, List, LoadError, Loading, Pill, Row, Screen, Segmented } from "../../src/ui";

export default function ProductsScreen() {
  const router = useRouter();
  const list = useApi<{ products: Product[] }>("products");
  const cur = useSession().me?.shop.currency ?? "USD";
  const [show, setShow] = useState<"all" | "missing">("all");
  const all = list.data?.products ?? [];
  // Archived products are off the store, so what they lack doesn't matter.
  const incomplete = all.filter((p) => p.status !== "archived" && p.missing.length > 0);
  const products = show === "missing" ? incomplete : all;
  return (
    <Screen title="Products" onRefresh={list.reload} refreshing={list.loading && !!list.data} right={<Button label="Import" onPress={() => router.push("/import")} a11y="Import from a supplier link" />}>
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!list.data ? (
        list.loading ? <Loading /> : null
      ) : all.length === 0 ? (
        <EmptyState heading="No products yet" body="Paste a link from your supplier, or share it to this app from the supplier's app or website." />
      ) : (
        <>
          {incomplete.length > 0 || show === "missing" ? (
            <Segmented label="Which products" value={show} onChange={setShow} options={[["all", "All"], ["missing", `Needs details (${incomplete.length})`]]} />
          ) : null}
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
    </Screen>
  );
}
