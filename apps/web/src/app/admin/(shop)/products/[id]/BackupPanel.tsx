"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { removeBackupAction, setBackupAction, type BackupState } from "../../../backup-actions";

export type BackupView = {
  label: string;
  sourceUrl: string;
  gone: boolean;
  /** One row per option of ours, with what the backup charges and has, or null when it has no match. */
  rows: { option: string; cost: string | null; mainCost: string | null; stock: string | null }[];
};

/** A second supplier for when the main one runs out. */
export function BackupPanel({ productId, mainLabel, backup }: { productId: string; mainLabel: string; backup: BackupView | null }) {
  const [state, action] = useActionState(setBackupAction.bind(null, productId), {} as BackupState);
  const [removed, remove] = useActionState(removeBackupAction.bind(null, productId), {} as BackupState);
  const message = state.message ?? removed.message;
  return (
    <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="backup-heading">
      <div>
        <h2 id="backup-heading" className="font-semibold">Backup supplier</h2>
        <p className="hint">
          When {mainLabel} is out of stock or drops this listing, orders go to the backup instead of waiting for you, and your store keeps selling what the backup has.
        </p>
      </div>
      {message && <p className="banner banner-success" role="status">{message}</p>}
      {backup && (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Backup: <a href={backup.sourceUrl} target="_blank" rel="noreferrer" className="underline">{backup.label} listing ↗</a>
          </p>
          {backup.gone && <p className="banner banner-warning">The backup listing was taken down at the last check. Paste another one.</p>}
          <ul className="flex flex-col gap-1" aria-label="Backup options">
            {backup.rows.map((r) => (
              <li key={r.option} className="flex justify-between gap-3 border-b border-border pb-1">
                <span>{r.option === "Default" ? "This product" : r.option}</span>
                {r.cost ? (
                  <span className="hint num">
                    costs {r.cost}{r.mainCost && r.mainCost !== r.cost ? ` (main: ${r.mainCost})` : ""}{r.stock ? ` · ${r.stock}` : ""}
                  </span>
                ) : (
                  <span className="text-warning">No match at the backup</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <FormError message={state.error} />
      <form action={action} className="flex flex-wrap gap-2 items-end">
        <div className="field flex-1 min-w-64">
          <label className="label" htmlFor="backup-url">{backup ? "Another backup link" : "Backup supplier link"}</label>
          <input className="input" id="backup-url" name="url" type="url" placeholder="The same product from another listing or supplier" required />
        </div>
        <SubmitButton className="btn btn-secondary" pendingText="Checking…">{backup ? "Change backup" : "Add backup"}</SubmitButton>
      </form>
      {backup && (
        <form action={remove}>
          <SubmitButton className="btn btn-secondary btn-sm text-critical" pendingText="Removing…">Remove backup</SubmitButton>
        </form>
      )}
    </section>
  );
}
