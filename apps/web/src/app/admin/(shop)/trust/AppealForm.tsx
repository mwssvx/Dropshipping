"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { appealAction } from "../../trust-actions";

export function AppealForm({ noticeId, label }: { noticeId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(appealAction.bind(null, noticeId), {});
  if (state.saved) return <p className="banner banner-info" role="status">Sent. A person reads every appeal and replies here, usually within two working days.</p>;
  if (!open) return <div><button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>{label}</button></div>;
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor={`appeal-${noticeId}`}>What you changed, or why this is wrong</label>
        <textarea className="input" id={`appeal-${noticeId}`} name="message" required minLength={20} maxLength={4000} />
      </div>
      <div className="flex gap-2">
        <SubmitButton pendingText="Sending…">Send appeal</SubmitButton>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
