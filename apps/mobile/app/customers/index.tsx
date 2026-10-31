import { useEffect, useState } from "react";
import { useApi } from "../../src/api";
import { money, when } from "../../src/format";
import { useSession } from "../../src/session";
import { BackLink, EmptyState, Field, List, LoadError, Loading, Row, Screen } from "../../src/ui";

type Customer = { id: string; name: string | null; email: string; orders: number; spentMinor: number; lastOrderAt: string | null; tags: string[] };

/** The store's customers, latest buyers first, with a search over names and emails. */
export default function CustomersScreen() {
  const cur = useSession().me?.shop.currency ?? "USD";
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  // Waits for a pause in typing before asking the server.
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const list = useApi<{ customers: Customer[] }>(`customers?q=${encodeURIComponent(q)}`);
  const rows = list.data?.customers;
  return (
    <Screen title="Customers" back={<BackLink href="/" label="Today" />} onRefresh={list.reload} refreshing={list.loading && !!rows}>
      <Field label="Search customers" value={query} onChangeText={setQuery} placeholder="Name or email" autoCapitalize="none" />
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!rows ? (
        list.loading ? <Loading /> : null
      ) : rows.length === 0 ? (
        <EmptyState heading={q ? "No one matches" : "No customers yet"} body={q ? `No customer's name or email has "${q}" in it.` : "Everyone who buys or signs up on your store shows up here."} />
      ) : (
        <List>
          {rows.map((c) => (
            <Row
              key={c.id}
              href={`/customers/${c.id}` as never}
              title={c.name || c.email}
              subtitle={[
                c.name ? c.email : null,
                c.orders ? `${c.orders} ${c.orders === 1 ? "order" : "orders"} · ${money(c.spentMinor, cur)}${c.lastOrderAt ? ` · last ${when(c.lastOrderAt)}` : ""}` : "No orders yet",
                c.tags.length ? c.tags.join(", ") : null,
              ]
                .filter(Boolean)
                .join("\n")}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
