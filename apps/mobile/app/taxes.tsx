import { useState } from "react";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, List, LoadError, Loading, Row, Screen, Section, Segmented } from "../src/ui";

type Duties = "off" | "buyer_pays" | "included";
type Data = {
  currency: string;
  pricesIncludeTax: boolean;
  duties: Duties;
  registrations: { id: string; name: string; number: string | null }[];
  options: { code: string; name: string; note: string }[];
  quarter: string;
  report: { jurisdiction: string; label: string; orders: number; salesMinor: number; taxMinor: number }[];
};

const DUTIES: Record<Duties, string> = {
  buyer_pays: "Checkout tells buyers abroad that customs may charge duties or taxes when it arrives, so nobody refuses the parcel in surprise.",
  included: "Checkout tells buyers abroad there's nothing more to pay when it arrives. Pick this only if you or your supplier pay them.",
  off: "Nothing is said at checkout.",
};

/** Where the store collects tax, whether prices include it, what buyers abroad are told about duties, and the tax owed. */
export default function TaxesScreen() {
  const [period, setPeriod] = useState<"this" | "last">("this");
  const data = useApi<Data>(`taxes${period === "last" ? "?period=last" : ""}`);
  const [include, setInclude] = useState<"yes" | "no" | null>(null);
  const [duties, setDuties] = useState<Duties | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const includeV = include ?? (d?.pricesIncludeTax ? "yes" : "no");
  const dutiesV = duties ?? d?.duties ?? "off";
  const picked = d?.options.find((o) => o.code === place) ?? null;

  async function run(key: string, path: string, method: "PUT" | "POST" | "DELETE", body: unknown, after?: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, { method, body });
      setNote({ tone: "success", text: r.message });
      after?.();
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Taxes" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>We charge tax only to buyers in places where you've told us you're registered, at the buyer's local rate. Our sales fee is never taken on tax. An accountant can confirm where you need to register.</Body>
          <Section title="Where you collect tax">
            {d.registrations.length ? (
              <List>
                {d.registrations.map((r) => (
                  <Row
                    key={r.id}
                    title={r.name}
                    subtitle={r.number ?? undefined}
                    right={<Button label="Remove" kind="ghost" a11y={`Stop collecting tax in ${r.name}`} busy={busy === r.id} disabled={!!busy} onPress={() => void run(r.id, `taxes/registrations/${r.id}`, "DELETE", undefined)} />}
                  />
                ))}
              </List>
            ) : (
              <EmptyState heading="Nowhere yet" body="No tax is charged on any order until you add where you're registered." />
            )}
            {d.options.length ? (
              <Card>
                {picked ? (
                  <>
                    <List>
                      <Row title={picked.name} subtitle="Tap to pick another place" onPress={() => setPlace(null)} a11y={`${picked.name}. Pick another place`} />
                    </List>
                    <Body muted>{picked.note}</Body>
                    <Field label="Registration number (optional)" value={number} onChangeText={setNumber} autoCapitalize="none" />
                    <Button
                      label="Add registration"
                      busy={busy === "add"}
                      disabled={!!busy}
                      onPress={() =>
                        void run("add", "taxes/registrations", "POST", { jurisdiction: picked.code, number }, () => {
                          setPlace(null);
                          setNumber("");
                        })
                      }
                    />
                  </>
                ) : (
                  <>
                    <Body muted>Where you're registered:</Body>
                    <List>
                      {d.options.map((o) => (
                        <Row key={o.code} title={o.name} onPress={() => setPlace(o.code)} a11y={`Add ${o.name}`} />
                      ))}
                    </List>
                  </>
                )}
              </Card>
            ) : null}
          </Section>

          <Section title="Your prices">
            <Card>
              <Segmented
                label="Your prices"
                value={includeV}
                onChange={setInclude}
                options={[
                  ["yes", "Include tax"],
                  ["no", "Add tax at checkout"],
                ]}
              />
              <Body muted>{includeV === "yes" ? "Usual in the UK and EU. A $20 price is $20 at checkout." : "Usual in the US and Canada. Tax is added on top at checkout."}</Body>
              <Button label="Save prices" busy={busy === "prices"} disabled={!!busy || include === null} onPress={() => void run("prices", "taxes/prices", "PUT", { include: includeV === "yes" }, () => setInclude(null))} />
            </Card>
          </Section>

          <Section title="Import duties">
            <Card>
              <Body muted>A parcel going to another country can owe customs duty or import tax when it arrives. Say up front who pays. Nothing is said for orders in your own country, or between two EU countries.</Body>
              <Segmented
                label="Who pays import duties"
                value={dutiesV}
                onChange={setDuties}
                options={[
                  ["buyer_pays", "Buyers pay"],
                  ["included", "Included"],
                  ["off", "Don't say"],
                ]}
              />
              <Body>{DUTIES[dutiesV]}</Body>
              <Button label="Save import duties" busy={busy === "duties"} disabled={!!busy || duties === null} onPress={() => void run("duties", "taxes/duties", "PUT", { policy: dutiesV }, () => setDuties(null))} />
            </Card>
          </Section>

          <Section title={`Tax collected, ${d.quarter}`}>
            <Segmented
              label="Period"
              value={period}
              onChange={setPeriod}
              options={[
                ["this", "This quarter"],
                ["last", "Last quarter"],
              ]}
            />
            {d.report.length ? (
              <List>
                {d.report.map((r) => (
                  <Row
                    key={r.jurisdiction}
                    title={`${r.label} (${r.jurisdiction})`}
                    subtitle={`${r.orders === 1 ? "1 order" : `${r.orders} orders`} · sales before tax ${money(r.salesMinor, d.currency)}`}
                    right={<Body>{money(r.taxMinor, d.currency)}</Body>}
                    a11y={`${r.label}: ${money(r.taxMinor, d.currency)} tax to pay`}
                  />
                ))}
              </List>
            ) : (
              <EmptyState heading="No tax collected in this period" body="After refunds. Your Money statement on the web lists the tax on every order." />
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}
