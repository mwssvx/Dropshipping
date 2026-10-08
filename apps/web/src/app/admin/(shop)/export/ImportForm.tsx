"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { importStoreAction, type ImportState } from "../../export-actions";

export function ImportForm() {
  const [state, action] = useActionState(importStoreAction, {} as ImportState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor="store-file">Store file (.json)</label>
        <input className="input" id="store-file" name="file" type="file" accept="application/json,.json" required />
      </div>
      <div><SubmitButton pendingText="Loading…">Load store file</SubmitButton></div>
    </form>
  );
}
