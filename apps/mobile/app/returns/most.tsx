import { useState } from "react";
import { View } from "react-native";
import { useApi } from "../../src/api";
import { BackLink, Body, Card, EmptyState, Heading, LoadError, Loading, Pill, Screen, Section, Segmented } from "../../src/ui";
import { space } from "../../src/theme";

type Report = {
  days: number;
  minSold: number;
  sold: number;
  summary: string | null;
  products: { productId: string; title: string; backText: string; high: boolean; why: string; fix: string | null }[];
};

const PERIODS = [
  ["30", "30 days"],
  ["90", "90 days"],
  ["365", "12 months"],
] as const;

/** Which products come back most, and what to do about the ones that come back too often. */
export default function ReturnedMostScreen() {
  const [days, setDays] = useState<(typeof PERIODS)[number][0]>("90");
  const report = useApi<Report>(`returns/most?days=${days}`);
  const r = report.data;
  return (
    <Screen title="Returned most" back={<BackLink href="/returns" label="Returns" />} onRefresh={report.reload} refreshing={report.loading && !!r}>
      <Segmented label="Period" options={PERIODS.map(([v, l]) => [v, l] as [typeof v, string])} value={days} onChange={setDays} />
      <LoadError error={report.error} stale={report.stale} retry={report.reload} />
      {!r ? (
        report.loading ? <Loading /> : null
      ) : !r.summary ? (
        <EmptyState heading="Nothing sold yet" body="Once orders come in, this shows which products come back and why." />
      ) : (
        <>
          <Body>{r.summary}</Body>
          {r.products.length ? (
            <Section title="By product">
              {r.products.map((p) => (
                <Card key={p.productId}>
                  <View style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
                    <Heading>{p.title}</Heading>
                    <Pill label={p.backText} tone={p.high ? "critical" : "neutral"} />
                  </View>
                  {p.why ? <Body muted>{p.why}</Body> : null}
                  {p.fix ? <Body>{p.fix}</Body> : null}
                </Card>
              ))}
            </Section>
          ) : null}
          <Body muted>{`Counts items from orders paid in the period, so the share is of what sold then. Declined returns don't count, and a share shows once ${r.minSold} have sold.`}</Body>
        </>
      )}
    </Screen>
  );
}
