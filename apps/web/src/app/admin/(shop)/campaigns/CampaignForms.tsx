"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import { saveCampaignAction, saveMailingAddressAction, sendTestCampaignAction, startCampaignAction, type TestState } from "../../campaign-actions";

type Draft = { subject: string; body: string; buttonLabel: string | null; buttonPath: string | null; audience: string };

export function CampaignEditor({ id, initial, audiences, saved }: { id: string | null; initial?: Draft; audiences: { value: string; label: string; size: number }[]; saved?: boolean }) {
  const [state, action] = useActionState(saveCampaignAction.bind(null, id), (saved ? { saved: true } : {}) as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Draft saved.</p>}
      <div className="field">
        <label className="label" htmlFor="subject">Subject</label>
        <input className="input" id="subject" name="subject" required maxLength={150} defaultValue={initial?.subject} placeholder="Our autumn sale starts now" />
      </div>
      <div className="field">
        <label className="label" htmlFor="body">Email</label>
        <textarea className="input min-h-48" id="body" name="body" required defaultValue={initial?.body ?? "Hi {first_name},\n\n"} />
        <p className="hint">Plain text, so it lands in the inbox rather than the promotions tab. {"{first_name}"} becomes each buyer&apos;s first name.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label className="label" htmlFor="buttonLabel">Link text (optional)</label>
          <input className="input" id="buttonLabel" name="buttonLabel" maxLength={40} defaultValue={initial?.buttonLabel ?? ""} placeholder="Shop the sale" />
        </div>
        <div className="field">
          <label className="label" htmlFor="buttonPath">Goes to</label>
          <input className="input" id="buttonPath" name="buttonPath" defaultValue={initial?.buttonPath ?? "/"} placeholder="/collections/all" />
          <p className="hint">A page on your store. We count who clicks it.</p>
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="audience">Send to</label>
        <select className="input" id="audience" name="audience" defaultValue={initial?.audience ?? "subscribers"}>
          {audiences.map((a) => <option key={a.value} value={a.value}>{a.label} ({a.size})</option>)}
        </select>
      </div>
      <SubmitButton className="btn btn-primary self-start">{id ? "Save draft" : "Save and preview"}</SubmitButton>
    </form>
  );
}

export function TestSendForm({ id, email }: { id: string; email: string }) {
  const [state, action] = useActionState(sendTestCampaignAction.bind(null, id), {} as TestState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      {state.sentTo && <p className="banner banner-success" role="status">Test sent to {state.sentTo}.</p>}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="field flex-1 min-w-48">
          <label className="label" htmlFor="test-to">Send a test to</label>
          <input className="input" id="test-to" name="to" type="email" defaultValue={email} required />
        </div>
        <SubmitButton className="btn btn-secondary" pendingText="Sending…">Send test</SubmitButton>
      </div>
    </form>
  );
}

export function SendForm({ id, recipients, disabled }: { id: string; recipients: number; disabled?: string | null }) {
  const [state, action] = useActionState(startCampaignAction.bind(null, id), {} as FormState);
  const [when, setWhen] = useState<"now" | "later">("now");
  return (
    <form
      action={(form) => {
        // The time picker is in the merchant's own time zone; the server gets an exact instant.
        const local = String(form.get("local") ?? "");
        if (local) form.set("scheduledFor", new Date(local).toISOString());
        return action(form);
      }}
      className="flex flex-col gap-3"
    >
      <FormError message={state.error ?? disabled ?? undefined} />
      <fieldset className="flex flex-wrap gap-3">
        <legend className="sr-only">When</legend>
        <label className="chip"><input type="radio" name="when" value="now" checked={when === "now"} onChange={() => setWhen("now")} /> Send now</label>
        <label className="chip"><input type="radio" name="when" value="later" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule</label>
      </fieldset>
      {when === "later" && (
        <div className="field max-w-xs">
          <label className="label" htmlFor="local">Date and time</label>
          <input className="input" id="local" name="local" type="datetime-local" required />
        </div>
      )}
      <SubmitButton className="btn btn-primary self-start" pendingText="Starting…">
        {when === "now" ? `Send to ${recipients} ${recipients === 1 ? "person" : "people"}` : "Schedule"}
      </SubmitButton>
    </form>
  );
}

export function MailingAddressForm({ value }: { value: string | null }) {
  const [state, action] = useActionState(saveMailingAddressAction, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Address saved.</p>}
      <div className="field">
        <label className="label" htmlFor="mailingAddress">Mailing address</label>
        <textarea className="input min-h-20" id="mailingAddress" name="mailingAddress" defaultValue={value ?? ""} placeholder={"Lumen Goods\n12 Elm St\nAustin TX 78701"} />
        <p className="hint">Shown at the foot of every marketing email, as anti-spam law requires. A PO box works.</p>
      </div>
      <SubmitButton className="btn btn-secondary self-start">Save address</SubmitButton>
    </form>
  );
}
