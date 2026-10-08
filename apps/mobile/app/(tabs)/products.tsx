import { useRouter } from "expo-router";
import { useApi } from "../../src/api";
import { money } from "../../src/format";
import { STATUS, type Product } from "../../src/product";
import { useSession } from "../../src/session";
import { Button, EmptyState, List, LoadError, Loading, Pill, Row, Screen } from "../../src/ui";

export default function ProductsScreen() {
  const router = useRouter();
  const list = useApi<{ products: Product[] }>("products");
  const cur = useSession().me?.shop.currency ?? "USD";
  const products = list.data?.products ?? [];
  return (
    <Screen title="Products" onRefresh={list.reload} refreshing={list.loading && !!list.data} right={<Button label="Import" onPress={() => router.push("/import")} a11y="Import from a supplier link" />}>
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!list.data ? (
        list.loading ? <Loading /> : null
      ) : products.length === 0 ? (
        <EmptyState heading="No products yet" body="Paste a link from your supplier, or share it to this app from the supplier's app or website." />
      ) : (
        <List>
          {products.map((p) => {
            const v = p.variants[0];
            return (
              <Row
                key={p.id}
                href={`/products/${p.id}`}
                title={p.title}
                subtitle={v ? `${money(v.priceMinor, cur)}${p.variants.length > 1 ? ` · ${p.variants.length} options` : ""}${v.stock !== null ? ` · ${v.stock} in stock` : ""}` : "No price yet"}
                right={<Pill label={STATUS[p.status].label} tone={STATUS[p.status].tone} />}
              />
            );
          })}
        </List>
      )}
    </Screen>
  );
}
