"use client";
import { startTransition, useActionState, useRef, useState } from "react";
import { FormError } from "@/components/FormError";
import { stockCountAction, type CountState } from "../../../inventory-actions";

type Option = { variantId: string; title: string; sku: string | null; barcode: string | null; stock: number | null };

export function StockCountForm({ options }: { options: Option[] }) {
  const [state, action, pending] = useActionState(stockCountAction, {} as CountState);
  const form = useRef<HTMLFormElement>(null);
  const [scanned, setScanned] = useState<{ ok: boolean; text: string } | null>(null);
  const byCode = new Map<string, Option>();
  for (const o of options) for (const code of [o.sku, o.barcode]) if (code) byCode.set(code.trim().toLowerCase(), o);
  // A scanner types the code and presses Enter: each scan adds one to that option's count.
  function scan(code: string) {
    const o = byCode.get(code.trim().toLowerCase());
    if (!o) return setScanned({ ok: false, text: `No option has the barcode or SKU ${code.trim()}.` });
    const box = form.current?.elements.namedItem(`count.${o.variantId}`) as HTMLInputElement | null;
    if (!box) return;
    const n = (Number(box.value) || 0) + 1;
    box.value = String(n);
    setScanned({ ok: true, text: `${o.title}: ${n}` });
  }
  return (
    // Submitted by hand so an error keeps what was typed; a new key after saving empties the boxes.
    <form
      key={state.key ?? "count"}
      ref={form}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.message && <p className="banner banner-success" role="status">{state.message}</p>}
      <div className="field max-w-sm">
        <label className="label" htmlFor="scan">Scan a barcode</label>
        <input
          className="input"
          id="scan"
          autoComplete="off"
          placeholder="Scan or type a barcode or SKU, then Enter"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (e.currentTarget.value.trim()) scan(e.currentTarget.value);
            e.currentTarget.value = "";
          }}
        />
        <p className={scanned && !scanned.ok ? "text-sm text-critical" : "hint"} aria-live="polite">{scanned?.text ?? "Each scan adds one to that option's count."}</p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left hint">
              <th className="p-3 font-medium">Option</th>
              <th className="p-3 font-medium text-right">Expected</th>
              <th className="p-3 font-medium">Counted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {options.map((o) => (
              <tr key={o.variantId}>
                <td className="p-3">{o.title}{(o.sku || o.barcode) && <span className="hint"> · {[o.sku, o.barcode].filter(Boolean).join(" · ")}</span>}</td>
                <td className="p-3 num text-right">{o.stock ?? "Not counted"}</td>
                <td className="p-3"><input className="input num w-24" name={`count.${o.variantId}`} inputMode="numeric" aria-label={`Counted ${o.title}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="submit" className="btn btn-primary self-start" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save count"}</button>
    </form>
  );
}
