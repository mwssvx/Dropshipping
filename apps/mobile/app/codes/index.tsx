import { useState } from "react";
import { send, useApi } from "../../src/api";
import { money, parseMoney, when } from "../../src/format";
import { useSession } from "../../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, List, LoadError, Loading, Row, Screen, Section, Segmented, Toggle } from "../../src/ui";

type Code = { id: string; code: string; summary: string; automatic: boolean; firstOrderOnly: boolean; active: boolean; used: number; salesMinor: number; usageLimit: number | null; endsAt: string | null };
type Kind = "percent" | "amount" | "free_shipping";

/** The store's discount codes: make an everyday one, see how each is doing, turn them on and off. */
export default function CodesScreen() {
  const cur = useSession().me?.shop.currency ?? "USD";
  const list = useApi<{ codes: Code[] }>("codes");
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<Kind>("percent");
  const [value, setValue] = useState("");
  const [firstOrderOnly, setFirstOrderOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  async function create() {
    const amount = kind === "amount" ? parseMoney(value) : kind === "percent" ? Number(value) : 0;
    if (kind !== "free_shipping" && (amount === null || !Number.isFinite(amount) || amount <= 0)) {
      setNote({ tone: "bad", text: kind === "percent" ? "Enter how many percent to take off, like 10." : "Enter the amount to take off, like 5." });
      return;
    }
    setBusy(true);
    try {
      const r = await send<{ message: string }>("codes", "POST", { code: code.trim().toUpperCase(), kind, value: amount, firstOrderOnly });
      if (r !== "queued") setNote({ tone: "good", text: r.message });
      setCode("");
      setValue("");
      setFirstOrderOnly(false);
      list.reload();
    } catch (e) {
      setNote({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function turn(c: Code, active: boolean) {
    try {
      const r = await send<{ message: string }>(`codes/${c.id}`, "POST", { active }, `${active ? "Turn on" : "Turn off"} ${c.code}`);
      setNote({ tone: "good", text: r === "queued" ? `${c.code} changes once you're back online.` : r.message });
      list.reload();
    } catch (e) {
      setNote({ tone: "bad", text: (e as Error).message });
    }
  }

  const codes = list.data?.codes;
  return (
    <Screen title="Discount codes" back={<BackLink href="/" label="Today" />} onRefresh={list.reload} refreshing={list.loading && !!codes}>
      {note && <Banner tone={note.tone === "good" ? "success" : "critical"}>{note.text}</Banner>}
      <Section title="New code">
        <Card>
          <Field label="Code" value={code} onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} placeholder="WELCOME10" autoCapitalize="none" hint="Letters, numbers, - and _. Buyers type it at checkout." />
          <Segmented
            label="What it does"
            options={[
              ["percent", "% off"],
              ["amount", "Amount off"],
              ["free_shipping", "Free shipping"],
            ]}
            value={kind}
            onChange={(v) => setKind(v as Kind)}
          />
          {kind !== "free_shipping" && (
            <Field label={kind === "percent" ? "Percent off" : "Amount off"} value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder={kind === "percent" ? "10" : "5.00"} />
          )}
          <Toggle label="First order only" value={firstOrderOnly} onChange={setFirstOrderOnly} />
          <Button label="Create code" onPress={create} busy={busy} disabled={code.length < 3} />
          <Body muted>Limits, dates, buy-one-get-one and codes for chosen products are on the website under Marketing.</Body>
        </Card>
      </Section>
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      <List>
        <Row href="/code-batches" title="One-time codes" subtitle="A batch of codes that each work once, for parcel cards or a market stall" />
      </List>
      {!codes ? (
        list.loading ? <Loading /> : null
      ) : codes.length === 0 ? (
        <EmptyState heading="No codes yet" body="Make one above and share it with your buyers." />
      ) : (
        <Section title="Your codes">
          {codes.map((c) => (
            <Card key={c.id}>
              <Heading>{c.automatic ? `${c.code} (applies by itself)` : c.code}</Heading>
              <Body>{c.summary}{c.firstOrderOnly ? " · first order only" : ""}</Body>
              <Body muted>
                {c.used ? `Used ${c.used} ${c.used === 1 ? "time" : "times"} · ${money(c.salesMinor, cur)} sold` : "Not used yet"}
                {c.usageLimit ? ` · ${Math.max(0, c.usageLimit - c.used)} of ${c.usageLimit} left` : ""}
                {c.endsAt ? ` · ends ${when(c.endsAt)}` : ""}
              </Body>
              <Toggle label={`${c.code} is on`} value={c.active} onChange={(v) => turn(c, v)} />
            </Card>
          ))}
        </Section>
      )}
    </Screen>
  );
}
