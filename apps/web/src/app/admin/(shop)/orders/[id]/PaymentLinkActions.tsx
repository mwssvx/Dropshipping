"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../../actions";
import { resendPaymentLinkAction } from "../../../payment-link-actions";

export function PaymentLinkActions({ orderId, url }: { orderId: string; url: string }) {
  const [state, action] = useActionState(resendPaymentLinkAction.bind(null, orderId), {} as FormState);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <FormError message={state.error} />
      {state.saved && <p className="text-sm text-success" role="status">Sent again.</p>}
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="pay-url">Payment link</label>
        <input className="input flex-1 text-sm" id="pay-url" readOnly value={url} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <form action={action}><SubmitButton className="btn btn-secondary" pendingText="Sending…">Email the link again</SubmitButton></form>
    </div>
  );
}
