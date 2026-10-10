"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { releaseHeldOrderAction } from "../../../actions";
import { refundAction } from "../../../money-actions";

/** On a held order: send it to the supplier after all, or refund it in full so nothing is bought. */
export function RiskActions({ orderId, canRefund }: { orderId: string; canRefund: boolean }) {
  const [sent, send] = useActionState(releaseHeldOrderAction.bind(null, orderId), {});
  const [refunded, refund] = useActionState(refundAction.bind(null, orderId), {});
  return (
    <div className="flex flex-col gap-2">
      <FormError message={sent.error ?? refunded.error} />
      {refunded.message && <p className="banner banner-info" role="status">{refunded.message}</p>}
      <div className="flex gap-2 flex-wrap">
        <form action={send}>
          <SubmitButton className="btn btn-primary" pendingText="Sending…">It&apos;s fine, send it</SubmitButton>
        </form>
        {canRefund && (
          <form action={refund}>
            <SubmitButton className="btn btn-secondary" pendingText="Refunding…">Refund in full</SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
