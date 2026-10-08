"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { addDomainAction, checkDomainAction } from "../../store-actions";

export function AddDomainForm() {
  const [state, action] = useActionState(addDomainAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor="hostname">Domain you own</label>
        <div className="flex gap-2 flex-wrap">
          <input id="hostname" name="hostname" className="input flex-1 min-w-56" required placeholder="shop.example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <SubmitButton className="btn btn-primary" pendingText="Adding…">Connect domain</SubmitButton>
        </div>
        <span className="hint">Bought it somewhere like Namecheap, GoDaddy or Cloudflare? Add it here, then copy the record below into that site.</span>
      </div>
    </form>
  );
}

export function CheckDomainButton({ id }: { id: string }) {
  const [state, action] = useActionState(checkDomainAction.bind(null, id), {});
  return (
    <form action={action} className="flex items-center gap-3 flex-wrap">
      <SubmitButton className="btn btn-secondary" pendingText="Checking…">Check now</SubmitButton>
      {state.saved && <span className="text-success text-sm" role="status">Connected.</span>}
      {state.error && <span className="text-sm text-muted" role="status">{state.error}</span>}
    </form>
  );
}
