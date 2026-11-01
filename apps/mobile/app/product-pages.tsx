import { useState } from "react";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen, Section, Segmented, Toggle } from "../src/ui";

type SoldOut = "last" | "show" | "hide";
type Note = { title: string; text: string };
type Data = {
  lowStockNote: number;
  restockAlertAt: number;
  badges: { sale: boolean; soldOut: boolean; newDays: number };
  soldOut: SoldOut;
  quickAdd: boolean;
  stayAfterAdd: boolean;
  shareButtons: boolean;
  recentSales: boolean;
  notes: Note[];
  notesMax: number;
};
type Form = {
  lowStockNote: string;
  restockAlertAt: string;
  saleBadge: boolean;
  soldOutBadge: boolean;
  newDays: string;
  soldOut: SoldOut;
  quickAdd: boolean;
  stayAfterAdd: boolean;
  shareButtons: boolean;
  recentSales: boolean;
};

const SOLD_OUT: Record<SoldOut, string> = {
  last: "Shoppers see what they can order first.",
  show: "Your own order, sold out or not.",
  hide: "Left out of collections, search and the home page until they're back. Their own page still works.",
};

/** How every product page and product card in the store behaves, set once for the whole store. */
export default function ProductPagesScreen() {
  const data = useApi<Data>("product-pages");
  const [edit, setEdit] = useState<Form | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const f: Form | null =
    edit ??
    (d
      ? {
          lowStockNote: String(d.lowStockNote),
          restockAlertAt: String(d.restockAlertAt),
          saleBadge: d.badges.sale,
          soldOutBadge: d.badges.soldOut,
          newDays: String(d.badges.newDays),
          soldOut: d.soldOut,
          quickAdd: d.quickAdd,
          stayAfterAdd: d.stayAfterAdd,
          shareButtons: d.shareButtons,
          recentSales: d.recentSales,
        }
      : null);
  const n = notes ?? (d ? Array.from({ length: d.notesMax }, (_, i) => d.notes[i] ?? { title: "", text: "" }) : null);
  const set = (patch: Partial<Form>) => f && setEdit({ ...f, ...patch });

  async function save(key: string, path: string, body: unknown, after: () => void) {
    setBusy(key);
    setMsg(null);
    try {
      const r = await api<{ message: string }>(path, { method: "PUT", body });
      setMsg({ tone: "success", text: r.message });
      after();
      await data.reload();
    } catch (e) {
      setMsg({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Product pages" back={<BackLink href="/products" label="Products" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !f || !n ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Stock">
            <Card>
              <Field
                label="Say how many are left at"
                value={f.lowStockNote}
                onChangeText={(v) => set({ lowStockNote: v })}
                keyboardType="number-pad"
                hint={`Product pages say "Only 3 left" at this many or fewer, from the real stock count. 0 turns it off.`}
              />
              <Field
                label="Email me at"
                value={f.restockAlertAt}
                onChangeText={(v) => set({ restockAlertAt: v })}
                keyboardType="number-pad"
                hint="For your own stock: one email when an option gets down to this many. 0 turns it off."
              />
            </Card>
          </Section>
          <Section title="Badges">
            <Card>
              <Toggle label="How much is off, like “-20%”, on products on sale" value={f.saleBadge} onChange={(v) => set({ saleBadge: v })} />
              <Toggle label="“Sold out” when nothing can be ordered" value={f.soldOutBadge} onChange={(v) => set({ soldOutBadge: v })} />
              <Field label="“New” for this many days" value={f.newDays} onChangeText={(v) => set({ newDays: v })} keyboardType="number-pad" hint="0 turns it off." />
            </Card>
          </Section>
          <Section title="Sold-out products">
            <Card>
              <Segmented
                label="Where sold-out products go"
                value={f.soldOut}
                onChange={(v) => set({ soldOut: v })}
                options={[
                  ["last", "At the end"],
                  ["show", "Where they are"],
                  ["hide", "Hidden"],
                ]}
              />
              <Body muted>{SOLD_OUT[f.soldOut]}</Body>
            </Card>
          </Section>
          <Section title="Shopping">
            <Card>
              <Toggle label="Show “Add to cart” on product cards" value={f.quickAdd} onChange={(v) => set({ quickAdd: v })} />
              <Toggle label="Stay on the page after “Add to cart”" value={f.stayAfterAdd} onChange={(v) => set({ stayAfterAdd: v })} />
              <Body muted>{f.stayAfterAdd ? "Shoppers see “Added to your cart” with buttons to the cart and checkout, and keep browsing." : "The cart opens after each add, which suits stores where most buyers get one thing."}</Body>
              <Toggle label="Show share buttons on product pages" value={f.shareButtons} onChange={(v) => set({ shareButtons: v })} />
              <Toggle label="Show how many sold in the last week" value={f.recentSales} onChange={(v) => set({ recentSales: v })} />
            </Card>
          </Section>
          <Button label="Save product pages" busy={busy === "all"} disabled={!!busy || !edit} onPress={() => void save("all", "product-pages", f, () => setEdit(null))} />

          <Section title="Notes under every product">
            <Body muted>{`Up to ${d.notesMax} notes that open and close under each product's description, like shipping times, returns or care. Leave one empty to leave it out.`}</Body>
            {n.map((note, i) => (
              <Card key={i}>
                <Field label={`Note ${i + 1} title`} value={note.title} onChangeText={(v) => setNotes(n.map((x, j) => (j === i ? { ...x, title: v } : x)))} placeholder={i === 0 ? "Shipping" : undefined} />
                <Field label={`Note ${i + 1} text`} value={note.text} onChangeText={(v) => setNotes(n.map((x, j) => (j === i ? { ...x, text: v } : x)))} multiline />
              </Card>
            ))}
            <Button label="Save notes" busy={busy === "notes"} disabled={!!busy || !notes} onPress={() => void save("notes", "product-pages/notes", { notes: n }, () => setNotes(null))} />
          </Section>
        </>
      )}
    </Screen>
  );
}
