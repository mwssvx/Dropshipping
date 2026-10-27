"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { swatchesAction, type SwatchesState } from "../../../customs-actions";

type Row = { value: string; color: string | null; named: string | null; picked: boolean };

/** A colour for each value of the colour option. Names like "Navy" fill themselves in; others are picked here. */
export function SwatchesForm({ productId, option, rows }: { productId: string; option: string; rows: Row[] }) {
  const [state, action, pending] = useActionState(swatchesAction.bind(null, productId), {} as SwatchesState);
  const [colors, setColors] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.value, r.color ?? ""])));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData();
        for (const r of rows) data.set(`swatch:${r.value}`, colors[r.value] ?? "");
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const color = colors[r.value] ?? "";
          return (
            <li key={r.value} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="w-32 font-medium">{r.value}</span>
              {color ? (
                <>
                  <input type="color" className="h-9 w-14 cursor-pointer rounded border" aria-label={`${option} ${r.value}`} value={color} onChange={(e) => setColors({ ...colors, [r.value]: e.target.value })} />
                  {r.named && color === r.named ? (
                    <span className="hint">From its name</span>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setColors({ ...colors, [r.value]: r.named ?? "" })}>
                      {r.named ? "Use its name's colour" : "No colour"}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <span className="hint">Shown as words only</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setColors({ ...colors, [r.value]: "#cccccc" })}>
                    Pick a colour for {r.value}
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save colours"}</button>
        {state.saved && !pending && !state.error && <p className="banner banner-success" role="status">Saved. Buyers see these dots when they pick a {option.toLowerCase()}.</p>}
      </div>
    </form>
  );
}
