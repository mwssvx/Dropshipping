"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { addWebhookAction, createApiKeyAction, testWebhookAction, type KeyState, type TestState } from "../../developer-actions";

export function ApiKeyForm() {
  const [state, action] = useActionState(createApiKeyAction, {} as KeyState);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {state.key && (
        <div className="banner banner-warning flex flex-col gap-2" role="status">
          <p><span className="font-semibold">Copy the key for {state.name} now.</span> For your safety we only show it once.</p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 min-w-0 break-all text-sm bg-surface rounded px-2 py-1" aria-label="New API key">{state.key}</code>
            <button type="button" className="btn btn-secondary" onClick={() => void navigator.clipboard.writeText(state.key!).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </div>
      )}
      <form action={action} className="flex flex-wrap gap-3 items-end">
        <FormError message={state.error} />
        <div className="field flex-1 min-w-48">
          <label className="label" htmlFor="key-name">Key name</label>
          <input className="input" id="key-name" name="name" required maxLength={60} placeholder="Inventory sync" />
        </div>
        <div className="field">
          <label className="label" htmlFor="key-access">Access</label>
          <select className="input" id="key-access" name="access" defaultValue="read">
            <option value="read">Read only</option>
            <option value="write">Read and write</option>
          </select>
        </div>
        <SubmitButton pendingText="Creating…">Create key</SubmitButton>
      </form>
    </div>
  );
}

export function WebhookForm({ events }: { events: { value: string; label: string }[] }) {
  const [state, action] = useActionState(addWebhookAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor="webhook-url">Address</label>
        <input className="input" id="webhook-url" name="url" type="url" required placeholder="https://example.com/webhooks/storefront" />
      </div>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <legend className="label mb-1">Send</legend>
        {events.map((e) => (
          <label key={e.value} className="flex items-center gap-2">
            <input type="checkbox" name="events" value={e.value} defaultChecked={e.value.startsWith("order.")} />
            {e.label} <code className="hint text-xs">{e.value}</code>
          </label>
        ))}
      </fieldset>
      <div><SubmitButton pendingText="Adding…">Add webhook</SubmitButton></div>
    </form>
  );
}

export function TestWebhookButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(testWebhookAction.bind(null, id), {} as TestState);
  return (
    <form action={action} className="flex items-center gap-2 flex-wrap">
      <button className="btn btn-secondary" disabled={pending}>{pending ? "Sending…" : "Send test"}</button>
      {state.message && <span role="status" className={`text-sm ${state.ok ? "text-success" : "text-critical"}`}>{state.message}</span>}
    </form>
  );
}

export function Secret({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="hint">Signing secret:</span>
      <code className="break-all">{shown ? value : `${value.slice(0, 10)}${"•".repeat(12)}`}</code>
      <button type="button" className="hint hover:text-ink" onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Show"}</button>
    </span>
  );
}
