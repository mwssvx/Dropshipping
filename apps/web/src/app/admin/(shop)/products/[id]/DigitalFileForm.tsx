"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { digitalFileAction, type DigitalState } from "../../../digital-actions";

/** The file a buyer gets after paying for a digital product, and the button to stop selling it as one. */
export function DigitalFileForm({ productId, file }: { productId: string; file: { name: string; size: string } | null }) {
  const [state, action, pending] = useActionState(digitalFileAction.bind(null, productId), {} as DigitalState);
  return (
    <div className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && !pending && !state.error && (
        <p className="banner banner-success" role="status">
          {state.saved === "uploaded" ? "Uploaded. Buyers get a download link as soon as they pay, and nothing is shipped." : "Removed. This product ships as a parcel again."}
        </p>
      )}
      {file && (
        <form action={action} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p>File: <strong>{file.name}</strong> <span className="hint">· {file.size}</span></p>
          <input type="hidden" name="remove" value="1" />
          <button type="submit" className="btn btn-secondary" disabled={pending}>Remove file</button>
        </form>
      )}
      <form action={action} className="flex flex-wrap gap-2 items-end">
        <div className="field flex-1 min-w-64">
          <label className="label" htmlFor="digital-file">{file ? "Replace the file" : "File to sell"}</label>
          <input className="input" id="digital-file" name="file" type="file" required />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Uploading…" : "Upload"}</button>
      </form>
    </div>
  );
}
