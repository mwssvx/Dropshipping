"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import { inviteAction, transferOwnershipAction, type InviteFormState } from "../../team-actions";

export function InviteForm() {
  const [state, action] = useActionState(inviteAction, {} as InviteFormState);
  return (
    <form action={action} className="flex flex-col gap-3" key={state.saved ? state.email : "invite"}>
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Invite sent to {state.email}. The link works for a week.</p>}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="field flex-1 min-w-56">
          <label className="label" htmlFor="invite-email">Email</label>
          <input className="input" id="invite-email" name="email" type="email" required defaultValue={state.saved ? "" : state.email} placeholder="name@example.com" />
        </div>
        <div className="field">
          <label className="label" htmlFor="invite-role">Role</label>
          <select className="input" id="invite-role" name="role" defaultValue="staff">
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <SubmitButton pendingText="Sending…">Send invite</SubmitButton>
      </div>
    </form>
  );
}

export function TransferForm({ people }: { people: { id: string; label: string }[] }) {
  const [state, action] = useActionState(transferOwnershipAction, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor="new-owner">New owner</label>
        <select className="input" id="new-owner" name="userId">
          {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <label className="flex gap-2 items-start text-sm">
        <input type="checkbox" name="confirm" className="mt-1" />
        <span>I understand the new owner controls the plan, payouts and the team, and I can&apos;t undo this myself.</span>
      </label>
      <SubmitButton className="btn btn-secondary self-start" pendingText="Handing over…">Make them the owner</SubmitButton>
    </form>
  );
}
