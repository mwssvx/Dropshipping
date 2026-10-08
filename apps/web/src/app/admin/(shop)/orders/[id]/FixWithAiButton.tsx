"use client";
import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { fixOrderAction } from "../../../ai-actions";

/** Let the order fixer look at it: it retries, or proposes a refund and a message for you to approve. */
export function FixWithAiButton({ orderId }: { orderId: string }) {
  const [state, action] = useActionState(fixOrderAction.bind(null, orderId), {});
  return (
    <form action={action} className="flex flex-col gap-2 border-t border-border pt-3">
      <FormError message={state.error} />
      {state.message ? (
        <div className="banner banner-info flex flex-col gap-1" role="status">
          <span className="whitespace-pre-line">{state.message}</span>
          <Link href="/admin/assistant" className="underline font-medium">See what&apos;s waiting for your OK →</Link>
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <SubmitButton className="btn btn-secondary" pendingText="Looking into it…">Ask AI to sort it out</SubmitButton>
          <span className="hint">It can retry the supplier; refunds and buyer emails wait for your OK.</span>
        </div>
      )}
    </form>
  );
}
