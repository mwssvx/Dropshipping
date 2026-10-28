"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { marginCheckAction, saveAiSettingsAction } from "../../ai-actions";

export function AiSettingsForm(props: { budget: string; planMax: string; topics: { key: string; label: string; on: boolean }[]; autoPause: boolean; shopper: boolean; weeklyReview: boolean; skills: { key: string; title: string; when: string; on: boolean }[] }) {
  const [state, action] = useActionState(saveAiSettingsAction, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-info" role="status">Saved.</p>}
      <div className="field max-w-xs">
        <label className="label" htmlFor="budget">Monthly AI budget (US$)</label>
        <input className="input num" id="budget" name="budget" inputMode="decimal" defaultValue={props.budget} placeholder={props.planMax} />
        <span className="hint">Up to ${props.planMax} is included in your plan. The assistants stop for the month when it&apos;s used.</span>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1">Buyer questions the assistant may answer without you checking first</legend>
        <div className="flex flex-wrap gap-2">
          {props.topics.map((t) => (
            <label key={t.key} className="chip">
              <input type="checkbox" name="topics" value={t.key} defaultChecked={t.on} /> {t.label}
            </label>
          ))}
        </div>
        <span className="hint">Replies that mention refunds, discounts or anything free always wait for you, and so do refunds, cancellations and complaints.</span>
      </fieldset>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="autoPause" defaultChecked={props.autoPause} className="mt-1 size-4" />
        <span>
          <span className="font-medium">Let margin watch take money-losing products off sale on its own</span>
          <span className="hint block">Price changes over 10% always wait for you.</span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="shopper" defaultChecked={props.shopper} className="mt-1 size-4" />
        <span>
          <span className="font-medium">Show the shopping assistant on your store</span>
          <span className="hint block">Shoppers can ask it about your products, sizes, delivery and returns. It only reads what your store already shows, can&apos;t see orders or change anything, and uses at most half of your monthly AI budget.</span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="weeklyReview" defaultChecked={props.weeklyReview} className="mt-1 size-4" />
        <span>
          <span className="font-medium">Review my store every Monday</span>
          <span className="hint block">The business analyst reads last month&apos;s numbers and leaves a few suggestions on the Insights page. Each review uses a few cents of your AI budget.</span>
        </span>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1">Skills the Assistant uses</legend>
        <div className="flex flex-col gap-2">
          {props.skills.map((s) => (
            <label key={s.key} className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="skills" value={s.key} defaultChecked={s.on} className="mt-1 size-4" />
              <span>
                <span className="font-medium">{s.title}</span>
                <span className="hint block">For {s.when}.</span>
              </span>
            </label>
          ))}
        </div>
        <span className="hint">Each skill is a playbook the Assistant reads only when a question needs it, so having them on costs next to nothing.</span>
      </fieldset>
      <div><SubmitButton>Save</SubmitButton></div>
    </form>
  );
}

export function MarginCheckButton() {
  const [state, action] = useActionState(marginCheckAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      {state.message && <p className="banner banner-info whitespace-pre-line" role="status">{state.message}</p>}
      <div><SubmitButton className="btn btn-secondary" pendingText="Checking…">Check margins now</SubmitButton></div>
    </form>
  );
}
