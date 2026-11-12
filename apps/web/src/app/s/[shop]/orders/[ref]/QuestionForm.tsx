"use client";
import { useActionState, useEffect, useRef } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { askAboutOrderAction } from "../../actions";

export type QuestionText = { sent: string; label: string; placeholder: string; sending: string; send: string };

export function QuestionForm({ handle, orderRef, text: t }: { handle: string; orderRef: string; email: string; text: QuestionText }) {
  const [state, action] = useActionState(askAboutOrderAction.bind(null, handle, orderRef), {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.sent) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.sent && <p className="banner banner-info" role="status">{t.sent}</p>}
      <div className="field">
        <label className="label" htmlFor="question">{t.label}</label>
        <textarea id="question" name="message" className="input" rows={3} required minLength={3} maxLength={4000} placeholder={t.placeholder} />
      </div>
      <div><SubmitButton pendingText={t.sending}>{t.send}</SubmitButton></div>
    </form>
  );
}
