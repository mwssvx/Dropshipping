"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { openTicketAction, replyToTicketAction, type SupportState } from "../../support-actions";

export function NewTicketForm() {
  const [state, action] = useActionState(openTicketAction, {} as SupportState);
  return (
    <form action={action} key={state.sent} className="flex flex-col gap-3">
      {state.message && <p className="banner banner-success" role="status">{state.message}</p>}
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor="ticket-subject">What it&apos;s about</label>
        <input className="input" id="ticket-subject" name="subject" required maxLength={120} placeholder="My payout hasn't arrived" />
      </div>
      <div className="field">
        <label className="label" htmlFor="ticket-body">What happened</label>
        <textarea className="input min-h-32" id="ticket-body" name="body" required maxLength={5000} />
        <p className="hint text-sm">Add order numbers or links if you have them. Never send passwords or card numbers.</p>
      </div>
      <div><SubmitButton pendingText="Sending…">Send to our team</SubmitButton></div>
    </form>
  );
}

export function TicketReplyForm({ conversationId }: { conversationId: string }) {
  const [state, action] = useActionState(replyToTicketAction.bind(null, conversationId), {} as SupportState);
  return (
    <form action={action} key={state.sent} className="flex flex-col gap-2">
      <FormError message={state.error} />
      <label className="sr-only" htmlFor={`reply-${conversationId}`}>Add to this request</label>
      <textarea className="input" id={`reply-${conversationId}`} name="body" required maxLength={5000} placeholder="Add more, or say it's still not fixed" />
      <div><SubmitButton className="btn btn-secondary" pendingText="Sending…">Add to this request</SubmitButton></div>
    </form>
  );
}
