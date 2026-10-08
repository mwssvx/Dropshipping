"use client";
import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { writeListingAction } from "../../../ai-actions";

export function WriteListingButton({ productId, live }: { productId: string; live: boolean }) {
  const [state, action] = useActionState(writeListingAction.bind(null, productId), {});
  return (
    <form action={action} className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <p className="font-medium">Write the title and description with AI</p>
          <p className="hint">{live ? "This product is on sale, so you'll see the new wording before buyers do." : "It uses the supplier's details and only claims what they support."}</p>
        </div>
        <SubmitButton className="btn btn-secondary" pendingText="Writing…">Write with AI</SubmitButton>
      </div>
      <FormError message={state.error} />
      {state.message && (
        <p className="banner banner-info" role="status">
          {state.message} {live && <Link href="/admin/assistant" className="underline font-medium">Review it →</Link>}
        </p>
      )}
    </form>
  );
}
