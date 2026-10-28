"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FormError } from "@/components/FormError";
import { decideAgentAction } from "@/app/admin/ai-actions";
import { AGENT_LABEL } from "@/lib/agent-labels";

export type PendingAction = { id: string; agent: string; tool: string; summary: string; reason: string | null; input: Record<string, unknown> };

/** Something an agent wants to do. Drafted messages can be edited before they're sent. */
export function ApprovalCard({ action, compact }: { action: PendingAction; compact?: boolean }) {
  const [yes, approve] = useActionState(decideAgentAction.bind(null, action.id, true), {});
  const [no, reject] = useActionState(decideAgentAction.bind(null, action.id, false), {});
  const message = typeof action.input.message === "string" ? action.input.message : null;
  // What it will do, worked out before asking (the terms of a code, the products in a collection).
  const preview = Array.isArray(action.input.preview) ? action.input.preview.filter((l): l is string => typeof l === "string") : [];
  if (yes.saved || no.saved) {
    return (
      <div className="card p-4 text-sm" role="status">
        <span className="font-medium">{action.summary}</span>
        <p className="hint mt-1">{yes.saved ? (message ? "Sent." : "Done.") : "Turned down. Nothing was changed."}</p>
      </div>
    );
  }
  return (
    <article className="card p-4 flex flex-col gap-3" aria-label={action.summary}>
      <div className="flex flex-col gap-1">
        <span className="hint">{AGENT_LABEL[action.agent] ?? action.agent}</span>
        <p className="text-sm font-medium">{action.summary}</p>
        {action.reason && <p className="hint">Needs your OK: {action.reason.charAt(0).toLowerCase() + action.reason.slice(1)}</p>}
      </div>
      {preview.length > 0 && (
        <ul className="text-sm flex flex-col gap-1 list-disc pl-5" aria-label="What it will do">
          {preview.map((line, k) => (
            <li key={k} className={/at a loss/.test(line) ? "text-critical" : undefined}>{line}</li>
          ))}
        </ul>
      )}
      <form action={approve} className="flex flex-col gap-3">
        {message !== null && (
          <div className="field">
            <label className="label" htmlFor={`msg-${action.id}`}>Message to the buyer</label>
            <textarea className="input text-sm" id={`msg-${action.id}`} name="message" defaultValue={message} rows={compact ? 5 : 8} />
          </div>
        )}
        <FormError message={yes.error ?? no.error} />
        <Buttons approveLabel={message !== null ? "Send" : "Approve"} rejectLabel={message !== null ? "Discard" : "Don't do it"} reject={reject} />
      </form>
    </article>
  );
}

function Buttons({ approveLabel, rejectLabel, reject }: { approveLabel: string; rejectLabel: string; reject: (f: FormData) => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex gap-2 flex-wrap">
      <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Working…" : approveLabel}</button>
      <button type="submit" className="btn btn-secondary" formAction={reject} disabled={pending}>{rejectLabel}</button>
    </div>
  );
}

type Decided = { id: string; summary: string; status: string; error: string | null; input: Record<string, unknown> };

/** What the merchant just approved or turned down; the card itself goes once the page refreshes. */
export function DecidedCard({ action }: { action: Decided }) {
  const message = typeof action.input.message === "string";
  const outcome =
    action.status === "approved" ? (message ? "Sent." : "Done.") : action.status === "rejected" ? "Turned down. Nothing was changed." : `It didn't work: ${action.error ?? "unknown error"}`;
  return (
    <div className="card p-4 text-sm" role="status">
      <span className="font-medium">{action.summary}</span>
      <p className={`mt-1 ${action.status === "failed" ? "text-critical" : "hint"}`}>{outcome}</p>
    </div>
  );
}
