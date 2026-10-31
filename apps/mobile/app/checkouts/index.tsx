import { Linking, View } from "react-native";
import { useApi } from "../../src/api";
import { money, when } from "../../src/format";
import { useSession } from "../../src/session";
import { BackLink, Banner, EmptyState, List, LoadError, Loading, Pill, Row, Screen, Stat } from "../../src/ui";

type Checkout = { id: string; number: number; name: string | null; email: string; totalMinor: number; currency: string; items: number; createdAt: string; reminder: "none" | "sent" | "code"; paidAs: number | null };
type Data = { days: number; remindersOn: boolean; totals: { count: number; valueMinor: number; recovered: number }; checkouts: Checkout[] };

/** Buyers who got to checkout and didn't pay: what they left, whether they were reminded, and who came back. */
export default function CheckoutsScreen() {
  const cur = useSession().me?.shop.currency ?? "USD";
  const data = useApi<Data>("checkouts");
  const d = data.data;
  return (
    <Screen title="Left at checkout" back={<BackLink href="/orders" label="Orders" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          {!d.remindersOn ? <Banner tone="warning">Reminder emails are off, so nobody is reminded. Turn them on under Marketing on the website.</Banner> : null}
          {d.totals.count ? (
            <View style={{ flexDirection: "row", gap: 1 }}>
              <Stat label="Left unpaid" value={String(d.totals.count)} />
              <Stat label="Worth" value={money(d.totals.valueMinor, cur)} />
              <Stat label="Came back" value={String(d.totals.recovered)} />
            </View>
          ) : null}
          {d.checkouts.length === 0 ? (
            <EmptyState heading="Nobody left at checkout" body={`When a buyer leaves at checkout in the last ${d.days} days, it shows up here an hour later.`} />
          ) : (
            <List>
              {d.checkouts.map((c) => (
                <Row
                  key={c.id}
                  a11y={`Checkout by ${c.name || c.email}`}
                  title={c.name || c.email}
                  subtitle={[
                    `${money(c.totalMinor, c.currency)} · ${c.items} ${c.items === 1 ? "item" : "items"} · ${when(c.createdAt)}`,
                    c.reminder === "code" ? "Reminded, with a code" : c.reminder === "sent" ? "Reminded" : "Not reminded yet",
                  ].join("\n")}
                  right={c.paidAs === null ? <Pill label="Not yet" /> : <Pill label={c.paidAs === c.number ? "Paid" : `Paid as #${c.paidAs}`} tone="success" />}
                  onPress={() => void Linking.openURL(`mailto:${c.email}`)}
                />
              ))}
            </List>
          )}
        </>
      )}
    </Screen>
  );
}
