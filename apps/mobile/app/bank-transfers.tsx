import { useState } from "react";
import { Text } from "react-native";
import { api, useApi } from "../src/api";
import { money, when } from "../src/format";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, List, LoadError, Loading, Pill, Row, Screen, Section, Toggle } from "../src/ui";
import { color } from "../src/theme";

type Data = {
  on: boolean;
  details: string;
  days: number;
  limits: { min: number; max: number; default: number; detailsMax: number };
  freePlan: boolean;
  canEdit: boolean;
  waiting: { id: string; number: number; name: string; totalMinor: number; currency: string; createdAt: string; dueBy: string | null }[];
};

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/**
 * Buyers who'd rather not use a card pay into the store's account, with the order number as the
 * reference. Nothing goes to the supplier until someone sees the money arrive and marks it paid.
 */
export default function BankTransfersScreen() {
  const data = useApi<Data>("bank-transfers");
  const [edit, setEdit] = useState<{ on: boolean; details: string; days: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const s = edit ?? (d ? { on: d.on, details: d.details, days: String(d.days) } : null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("bank-transfers", { method: "PUT", body: { on: s!.on, details: s!.details, days: Number(s!.days) } });
      setNote({ tone: "success", text: r.message });
      setEdit(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const now = Date.now();
  return (
    <Screen title="Bank transfers" back={<BackLink href="/orders" label="Orders" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !s ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Buyers are emailed your account details with the order number as the reference. Nothing goes to the supplier until you see the money arrive and mark the order paid. If it doesn't arrive in time, the order stops waiting and the buyer can still pay by card.</Body>
          <Section title="Waiting for the money">
            {d.waiting.length ? (
              <List>
                {d.waiting.map((o) => {
                  const late = !!o.dueBy && new Date(o.dueBy).getTime() < now;
                  return (
                    <Row
                      key={o.id}
                      href={`/orders/${o.id}`}
                      a11y={`Order #${o.number}`}
                      title={`#${o.number} · ${o.name}`}
                      subtitle={`${money(o.totalMinor, o.currency)} · ordered ${when(o.createdAt)}`}
                      right={o.dueBy ? <Pill label={late ? "Past due" : `Due ${day.format(new Date(o.dueBy))}`} tone={late ? "warning" : "neutral"} /> : undefined}
                    />
                  );
                })}
              </List>
            ) : (
              <EmptyState heading="No transfers to look for" body="Orders buyers chose to pay by bank transfer show here until you mark them paid." />
            )}
          </Section>
          <Section title="Settings">
            <Card>
              {d.freePlan ? (
                <Body>Bank transfers are on paid plans, because on the free plan our 2% comes out of card payments.</Body>
              ) : d.canEdit ? (
                <>
                  <Toggle label="Let buyers pay by bank transfer" value={s.on} onChange={(v) => setEdit({ ...s, on: v })} />
                  {s.on ? (
                    <>
                      <Field
                        label="Account to pay into"
                        value={s.details}
                        onChangeText={(v) => setEdit({ ...s, details: v })}
                        multiline
                        placeholder={"Lamp Co Ltd\nIBAN DE89 3704 0044 0532 0130 00\nBIC COBADEFFXXX"}
                        hint={`The name on the account, and the IBAN or account and sort or routing number. Up to ${d.limits.detailsMax} characters.`}
                      />
                      <Field label="Days to pay" value={s.days} onChangeText={(v) => setEdit({ ...s, days: v })} keyboardType="number-pad" hint={`${d.limits.min} to ${d.limits.max} days.`} />
                    </>
                  ) : null}
                  <Button label="Save bank transfers" busy={busy} disabled={busy || !edit} onPress={save} />
                </>
              ) : (
                <Text style={{ color: color.ink }}>{`${d.on ? "Buyers can pay by bank transfer." : "Bank transfers are off."} The store owner can change this.`}</Text>
              )}
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
