"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { saveSizeChartAction } from "../../size-chart-actions";

type Chart = { id: string; name: string; unit: "cm" | "in"; columns: string[]; rows: string[][]; note: string | null; productIds: string[]; collectionIds: string[]; published: boolean };
type Choice = { id: string; title: string };

const BLANK: Omit<Chart, "id"> = {
  name: "",
  unit: "cm",
  columns: ["Size", "Chest", "Waist", "Length"],
  rows: ["S", "M", "L"].map((s) => [s, "", "", ""]),
  note: "Measured flat, garment laid out.",
  productIds: [],
  collectionIds: [],
  published: true,
};

/**
 * The table is edited in place (cells, add or remove sizes and columns) and sent as JSON. Every
 * field is controlled, so what the merchant typed stays when saving fails.
 */
export function SizeChartForm({ chart, products, collections }: { chart: Chart | null; products: Choice[]; collections: Choice[] }) {
  const start = chart ?? BLANK;
  const [state, action] = useActionState(saveSizeChartAction.bind(null, chart?.id ?? null), {});
  const [name, setName] = useState(start.name);
  const [unit, setUnit] = useState(start.unit);
  const [columns, setColumns] = useState(start.columns);
  const [rows, setRows] = useState(start.rows);
  const [note, setNote] = useState(start.note ?? "");
  const [productIds, setProductIds] = useState(new Set(start.productIds));
  const [collectionIds, setCollectionIds] = useState(new Set(start.collectionIds));
  const [published, setPublished] = useState(start.published);

  const setCell = (r: number, c: number, v: string) => setRows(rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };

  return (
    <form action={action} className="flex flex-col gap-5">
      <FormError message={state.error} />
      {state.message && <p role="status" className="banner banner-info">{state.message}</p>}
      <input type="hidden" name="table" value={JSON.stringify({ columns, rows })} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="field sm:col-span-2">
          <label className="label" htmlFor="chartName">Name</label>
          <input className="input" id="chartName" name="name" required maxLength={60} placeholder="T-shirts" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="chartUnit">Measurements in</label>
          <select className="input" id="chartUnit" name="unit" value={unit} onChange={(e) => setUnit(e.target.value as "cm" | "in")}>
            <option value="cm">Centimetres</option>
            <option value="in">Inches</option>
          </select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="label">Table</legend>
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead>
              <tr>
                {columns.map((c, j) => (
                  <th key={j} className="p-1 text-left font-normal">
                    <div className="flex items-center gap-1">
                      <input
                        className="input w-28 font-medium"
                        aria-label={`Column ${j + 1} heading`}
                        value={c}
                        onChange={(e) => setColumns(columns.map((x, k) => (k === j ? e.target.value : x)))}
                      />
                      {j > 0 && columns.length > 2 && (
                        <button
                          type="button"
                          className="hint hover:text-critical"
                          aria-label={`Remove column ${c || j + 1}`}
                          onClick={() => {
                            setColumns(columns.filter((_, k) => k !== j));
                            setRows(rows.map((r) => r.filter((_, k) => k !== j)));
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((v, j) => (
                    <td key={j} className="p-1">
                      <input className={`input w-28 ${j === 0 ? "font-medium" : "num"}`} aria-label={`${columns[j] || `Column ${j + 1}`} for ${row[0] || `row ${i + 1}`}`} value={v} onChange={(e) => setCell(i, j, e.target.value)} />
                    </td>
                  ))}
                  <td className="p-1">
                    {rows.length > 1 && (
                      <button type="button" className="hint hover:text-critical" aria-label={`Remove size ${row[0] || i + 1}`} onClick={() => setRows(rows.filter((_, k) => k !== i))}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary btn-sm" disabled={rows.length >= 30} onClick={() => setRows([...rows, columns.map(() => "")])}>Add size</button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={columns.length >= 8}
            onClick={() => {
              setColumns([...columns, ""]);
              setRows(rows.map((r) => [...r, ""]));
            }}
          >
            Add column
          </button>
        </div>
        <p className="hint">Write ranges like 86-91. Buyers can switch the table between centimetres and inches; the size column stays as it is.</p>
      </fieldset>

      <div className="field">
        <label className="label" htmlFor="chartNote">Note under the table</label>
        <textarea className="input" id="chartNote" name="note" rows={2} maxLength={500} placeholder="How to measure" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-1">
          <legend className="label">Products</legend>
          {products.length === 0 && <p className="hint">No products yet.</p>}
          <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="productIds" value={p.id} checked={productIds.has(p.id)} onChange={(e) => setProductIds(toggle(productIds, p.id, e.target.checked))} />
                {p.title}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1">
          <legend className="label">Collections</legend>
          {collections.length === 0 && <p className="hint">No collections yet.</p>}
          <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
            {collections.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="collectionIds" value={c.id} checked={collectionIds.has(c.id)} onChange={(e) => setCollectionIds(toggle(collectionIds, c.id, e.target.checked))} />
                {c.title}
              </label>
            ))}
          </div>
          <p className="hint">Every product in a collection gets this chart, unless it has its own.</p>
        </fieldset>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="published" checked={published} onChange={(e) => setPublished(e.target.checked)} /> Show on the store
      </label>
      <div><SubmitButton pendingText="Saving…">Save size chart</SubmitButton></div>
    </form>
  );
}
