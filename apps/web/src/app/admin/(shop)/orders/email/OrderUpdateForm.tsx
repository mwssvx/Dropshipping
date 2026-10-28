"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { emailOrdersAction, type OrderUpdateState } from "../../../bulk-order-actions";

export function OrderUpdateForm({ ids, back, shopName, count }: { ids: string[]; back: string; shopName: string; count: number }) {
  const [state, action] = useActionState(emailOrdersAction.bind(null, ids, back), {} as OrderUpdateState);
  return (
    <form action={action} className="card p-5 flex flex-col gap-3">
      <FormError message={state.error} />
      <p className="text-sm"><span className="hint">Subject:</span> An update on your order #… from {shopName}</p>
      <div className="field">
        <label className="label" htmlFor="update-message">Your update</label>
        <textarea
          className="input"
          id="update-message"
          name="message"
          rows={7}
          maxLength={1000}
          required
          placeholder={"Our supplier is running a few days behind with the holiday rush, so your order will ship by Friday instead of Wednesday. Sorry for the wait, and thank you for your patience!"}
        />
        <span className="hint">The email starts with &ldquo;Hi&rdquo; and their first name, and ends with a link to their order. Up to 1,000 characters.</span>
      </div>
      <SubmitButton className="btn btn-primary self-start" pendingText="Sending…">{count === 1 ? "Email 1 buyer" : `Email ${count} buyers`}</SubmitButton>
    </form>
  );
}
