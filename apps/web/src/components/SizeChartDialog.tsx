"use client";
import { useRef, useState } from "react";

export type SizeChartView = { name: string; unit: "cm" | "in"; columns: string[]; rows: { cm: string[][]; in: string[][] }; note: string | null };
type Text = { sizeChart: string; close: string; centimetres: string; inches: string };

/** "Size chart" on the product page: the table in a dialog, switchable between cm and inches. */
export function SizeChartDialog({ chart, t }: { chart: SizeChartView; t: Text }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [unit, setUnit] = useState(chart.unit);
  return (
    <>
      <button type="button" className="underline text-sm self-start" onClick={() => ref.current?.showModal()}>
        {t.sizeChart}
      </button>
      <dialog ref={ref} aria-labelledby="size-chart-title" className="card p-0 max-w-[calc(100vw-2rem)] w-[40rem] m-auto backdrop:bg-black/40" onClick={(e) => e.target === ref.current && ref.current?.close()}>
        <div className="p-5 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <h2 id="size-chart-title" className="text-lg font-semibold">{t.sizeChart}: {chart.name}</h2>
            <button type="button" className="hint hover:text-ink" onClick={() => ref.current?.close()} aria-label={t.close}>✕</button>
          </div>
          <div className="flex gap-2" role="group" aria-label={t.sizeChart}>
            {(["cm", "in"] as const).map((u) => (
              <button key={u} type="button" className={`chip ${unit === u ? "font-semibold" : ""}`} aria-pressed={unit === u} onClick={() => setUnit(u)}>
                {u === "cm" ? t.centimetres : t.inches}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  {chart.columns.map((c, i) => <th key={i} scope="col" className="text-left py-2 pr-4 font-medium">{i === 0 ? c : `${c} (${unit})`}</th>)}
                </tr>
              </thead>
              <tbody>
                {chart.rows[unit].map((r, i) => (
                  <tr key={i} className="border-b border-border">
                    {r.map((c, j) => (j === 0 ? <th key={j} scope="row" className="text-left py-2 pr-4 font-medium">{c}</th> : <td key={j} className="py-2 pr-4 num">{c || "–"}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {chart.note && <p className="hint whitespace-pre-line">{chart.note}</p>}
        </div>
      </dialog>
    </>
  );
}
