"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { uploadDocumentAction } from "../../money-actions";

export function UploadDocumentForm({ requirementId, label }: { requirementId: string; label: string }) {
  const [state, action] = useActionState(uploadDocumentAction.bind(null, requirementId), {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor={`file-${requirementId}`}>{label}</label>
        <input className="input" id={`file-${requirementId}`} name="file" type="file" accept="image/jpeg,image/png,application/pdf" required />
        <span className="hint">JPG, PNG or PDF, up to 5 MB. Sent securely to the payment processor; only you and they can see it.</span>
      </div>
      <div><SubmitButton pendingText="Sending…">Send document</SubmitButton></div>
    </form>
  );
}
