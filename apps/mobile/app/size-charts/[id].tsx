import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { api, useApi } from "../../src/api";
import { BackLink, Banner, Body, Button, Card, Field, List, LoadError, Loading, Row, Screen, Section, Segmented, Toggle } from "../../src/ui";

type Unit = "cm" | "in";
type Chart = { id: string; name: string; unit: Unit; columns: string[]; rows: string[][]; note: string | null; productIds: string[]; collectionIds: string[]; published: boolean };
type Choice = { id: string; title: string };
type Data = { chart: Chart; products: Choice[]; collections: Choice[] };
type Edit = { name: string; unit: Unit; columns: string; sizes: string; note: string; productIds: string[]; collectionIds: string[]; published: boolean };

/** Cells split by tabs (pasted from a spreadsheet) or else by commas. */
const cells = (line: string) => (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());

/** The typed table as columns and rows: one size per line; short lines get empty cells at the end. */
function table(e: Edit) {
  const columns = cells(e.columns).filter((c, i, all) => c || i < all.length - 1);
  const rows = e.sizes
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const r = cells(l);
      return r.length < columns.length ? [...r, ...Array<string>(columns.length - r.length).fill("")] : r;
    });
  return { columns, rows };
}

/** One size chart: its table, typed one size per line, the products and collections it's on, and deleting it. */
export default function SizeChartScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useApi<Data>(`size-charts/${id}`);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [find, setFind] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const c = d?.chart;
  useEffect(() => setConfirm(false), [c]);
  const f: Edit | null =
    edit ??
    (c
      ? {
          name: c.name,
          unit: c.unit,
          columns: c.columns.join(", "),
          sizes: c.rows.map((r) => r.join(", ")).join("\n"),
          note: c.note ?? "",
          productIds: c.productIds,
          collectionIds: c.collectionIds,
          published: c.published,
        }
      : null);
  const q = find.trim().toLowerCase();
  const matches = q && d && f ? d.products.filter((p) => !f.productIds.includes(p.id) && p.title.toLowerCase().includes(q)).slice(0, 5) : [];
  const title = (id: string) => d?.products.find((p) => p.id === id)?.title ?? "A product";

  async function save() {
    if (!f) return;
    setBusy("save");
    setNote(null);
    try {
      const r = await api<{ message: string }>(`size-charts/${id}`, {
        method: "PUT",
        body: { name: f.name, unit: f.unit, ...table(f), note: f.note, productIds: f.productIds, collectionIds: f.collectionIds, published: f.published },
      });
      setNote({ tone: "success", text: r.message });
      setEdit(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setNote(null);
    try {
      await api(`size-charts/${id}`, { method: "DELETE" });
      router.replace("/size-charts");
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
      setBusy(null);
    }
  }

  return (
    <Screen title={c?.name ?? "Size chart"} back={<BackLink href="/size-charts" label="Size charts" />} onRefresh={data.reload} refreshing={data.loading && !!c}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !f ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Section title="Table">
            <Card>
              <Field label="Name" value={f.name} onChangeText={(v) => setEdit({ ...f, name: v })} />
              <Segmented
                label="Measurements in"
                value={f.unit}
                onChange={(v) => setEdit({ ...f, unit: v })}
                options={[
                  ["cm", "Centimetres"],
                  ["in", "Inches"],
                ]}
              />
              <Field label="Columns" value={f.columns} onChangeText={(v) => setEdit({ ...f, columns: v })} autoCapitalize="words" hint="Split by commas. The first is the size name: Size, Chest, Waist, Length." />
              <Field
                label="Sizes"
                value={f.sizes}
                onChangeText={(v) => setEdit({ ...f, sizes: v })}
                multiline
                autoCapitalize="none"
                hint="One size per line, its measurements in the order of the columns, split by commas: M, 96-101, 81-86, 72. Ranges like 86-91 work."
              />
              <Field label="Note under the table (optional)" value={f.note} onChangeText={(v) => setEdit({ ...f, note: v })} placeholder="Measured flat, garment laid out." />
            </Card>
          </Section>
          <Section title="Products">
            <Card>
              {f.productIds.length ? (
                <List>
                  {f.productIds.map((p) => (
                    <Row key={p} title={title(p)} subtitle="Tap to take it off" onPress={() => setEdit({ ...f, productIds: f.productIds.filter((x) => x !== p) })} a11y={`Take ${title(p)} off this chart`} />
                  ))}
                </List>
              ) : (
                <Body muted>Not on any product of its own yet.</Body>
              )}
              <Field label="Add a product" value={find} onChangeText={setFind} placeholder="Search your products" autoCapitalize="none" />
              {matches.length ? (
                <List>
                  {matches.map((p) => (
                    <Row
                      key={p.id}
                      title={p.title}
                      onPress={() => {
                        setEdit({ ...f, productIds: [...f.productIds, p.id] });
                        setFind("");
                      }}
                      a11y={`Add ${p.title}`}
                    />
                  ))}
                </List>
              ) : null}
            </Card>
          </Section>
          {d.collections.length ? (
            <Section title="Collections">
              <Card>
                <Body muted>Every product in a collection gets this chart, unless it has its own.</Body>
                {d.collections.map((x) => (
                  <Toggle
                    key={x.id}
                    label={x.title}
                    value={f.collectionIds.includes(x.id)}
                    onChange={(v) => setEdit({ ...f, collectionIds: v ? [...f.collectionIds, x.id] : f.collectionIds.filter((y) => y !== x.id) })}
                  />
                ))}
              </Card>
            </Section>
          ) : null}
          <Card>
            <Toggle label="Show on the store" value={f.published} onChange={(v) => setEdit({ ...f, published: v })} />
            <Button label="Save size chart" busy={busy === "save"} disabled={!!busy || !edit} onPress={save} />
          </Card>
          <Section title="Delete">
            <Card>
              {confirm ? (
                <Button label="Delete this size chart" kind="danger" busy={busy === "delete"} disabled={!!busy} onPress={remove} />
              ) : (
                <Button label="Delete…" kind="ghost" a11y="Delete this size chart…" disabled={!!busy} onPress={() => setConfirm(true)} />
              )}
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
