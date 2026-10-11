"use client";
import { useActionState, useEffect, useRef } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { inboxReplyAction } from "../../../ai-actions";

export function ReplyForm({ conversationId, primary, hasOrder = true }: { conversationId: string; primary: boolean; hasOrder?: boolean }) {
  const [state, action] = useActionState(inboxReplyAction.bind(null, conversationId), {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-info" role="status">{hasOrder ? "Sent by email and shown on the buyer's order page." : "Sent by email."}</p>}
      <div className="field">
        <label className="label" htmlFor="reply">Write your own reply</label>
        <textarea id="reply" name="message" className="input" rows={4} required maxLength={4000} />
      </div>
      <div><SubmitButton className={`btn ${primary ? "btn-primary" : "btn-secondary"}`} pendingText="Sending…">Send reply</SubmitButton></div>
    </form>
  );
}
