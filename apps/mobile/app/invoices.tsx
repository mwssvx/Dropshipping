import { useState } from "react";
import { api, useApi } from "../src/api";
import { money, when } from "../src/format";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, List, LoadError, Loading, Pill, Row, Screen, Section } from "../src/ui";

type Settings = { legalName: string; address: string; prefix: string; nextNumber: string; footer: string };
type Data = {
  gaps: string[];
  settings: Settings;
  next: string;
  docs: { id: string; number: string; kind: "invoice" | "credit_note"; issuedAt: string; orderId: string; orderNumber: number; buyer: string; totalMinor: number; currency: string }[];
};

/** The details printed on every invoice and credit note, the next number, and the latest issued. */
export default function InvoicesScreen() {
  const data = useApi<Data>("invoices");
  const [edit, setEdit] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const f = edit ?? d?.settings ?? null;

  async function save() {
    if (!f) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("invoices", { method: "PUT", body: f });
      setNote({ tone: "success", text: r.message });
      setEdit(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Invoices" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !f ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Every paid order gets a numbered invoice, and every refund a credit note, in one series with no gaps. Buyers get a link in their order email. An issued invoice keeps the details it was issued with.</Body>
          {d.gaps.length ? <Banner tone="warning">{`Most tax offices need ${d.gaps.join(" and ")} on an invoice. Add ${d.gaps.length > 1 ? "them" : "it"} below.`}</Banner> : null}
          <Section title="Your details">
            <Card>
              <Field label="Registered business name" value={f.legalName} onChangeText={(v) => setEdit({ ...f, legalName: v })} placeholder="Glow Lamps LLC" />
              <Field label="Business address" value={f.address} onChangeText={(v) => setEdit({ ...f, address: v })} multiline />
              <Field label="Number prefix" value={f.prefix} onChangeText={(v) => setEdit({ ...f, prefix: v })} autoCapitalize="none" />
              <Field label="Next number" value={f.nextNumber} onChangeText={(v) => setEdit({ ...f, nextNumber: v })} keyboardType="number-pad" />
              <Field label="Footer (optional)" value={f.footer} onChangeText={(v) => setEdit({ ...f, footer: v })} multiline placeholder="Company number, bank details or a thank-you note" />
              <Body muted>{`The next one will be ${d.next}. Tax numbers come from Taxes and duties.`}</Body>
              <Button label="Save invoice details" busy={busy} disabled={busy || !edit} onPress={save} />
            </Card>
          </Section>
          <Section title="Issued">
            {d.docs.length === 0 ? (
              <EmptyState heading="No invoices yet" body="The first one is issued when an order is paid." />
            ) : (
              <List>
                {d.docs.map((doc) => (
                  <Row
                    key={doc.id}
                    href={`/orders/${doc.orderId}`}
                    title={`${doc.number} · ${money(doc.totalMinor, doc.currency)}`}
                    subtitle={`${when(doc.issuedAt)} · order #${doc.orderNumber} · ${doc.buyer}`}
                    right={doc.kind === "credit_note" ? <Pill label="Credit note" tone="neutral" /> : undefined}
                    a11y={`${doc.kind === "credit_note" ? "Credit note" : "Invoice"} ${doc.number}, order #${doc.orderNumber}`}
                  />
                ))}
              </List>
            )}
            <Body muted>Download the register for your accountant on the web, under Invoices.</Body>
          </Section>
        </>
      )}
    </Screen>
  );
}
