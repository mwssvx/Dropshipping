"use client";
import { useActionState, useEffect, useRef } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { askAboutOrderAction } from "../../actions";

export function QuestionForm({ handle, orderRef, email }: { handle: string; orderRef: string; email: string }) {
  const [state, action] = useActionState(askAboutOrderAction.bind(null, handle, orderRef), {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.sent) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.sent && <p className="banner banner-info" role="status">Thanks, we got your message. The reply will appear here and in your email ({email}).</p>}
      <div className="field">
        <label className="label" htmlFor="question">Ask a question about this order</label>
        <textarea id="question" name="message" className="input" rows={3} required minLength={3} maxLength={4000} placeholder="For example: when will it arrive?" />
      </div>
      <div><SubmitButton pendingText="Sending…">Send</SubmitButton></div>
    </form>
  );
}
