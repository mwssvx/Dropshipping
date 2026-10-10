"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../../actions";
import { sendReplacementAction } from "../../../return-actions";

/** Send items again for free, when a package was lost, damaged or wrong. */
export function ReplacementForm({ orderId, lines }: { orderId: string; lines: { id: string; title: string; quantity: number }[] }) {
  const [state, action] = useActionState(sendReplacementAction.bind(null, orderId), {} as FormState);
  return (
    <details className="group" open={!!state.error}>
      <summary className="cursor-pointer font-medium">Send a replacement</summary>
      <form action={action} className="flex flex-col gap-3 mt-3">
        <p className="hint">For a package that was lost, damaged or wrong. It goes to the supplier as a new order at no charge to the buyer, and they get an email. It counts as a cost in your profit report.</p>
        <FormError message={state.error} />
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3">
              <label htmlFor={`qty-${l.id}`} className="text-sm">{l.title}</label>
              <input id={`qty-${l.id}`} name={`qty-${l.id}`} className="input num w-20" inputMode="numeric" defaultValue={l.quantity} aria-describedby={`of-${l.id}`} />
              <span id={`of-${l.id}`} className="hint whitespace-nowrap">of {l.quantity}</span>
            </li>
          ))}
        </ul>
        <div className="field">
          <label className="label" htmlFor="replacement-note">Message to the buyer (optional)</label>
          <textarea id="replacement-note" name="note" className="input" rows={2} maxLength={1000} placeholder="Sorry it got lost. Here's a new one." />
        </div>
        <SubmitButton className="btn btn-primary self-start" pendingText="Sending…">Send replacement</SubmitButton>
      </form>
    </details>
  );
}
