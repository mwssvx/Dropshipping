"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import { saveCurrenciesAction } from "../../money-actions";

export function CurrenciesForm({ storeCurrency, options, enabled, round }: { storeCurrency: string; options: { code: string; name: string }[]; enabled: string[]; round: boolean }) {
  const [state, action] = useActionState(saveCurrenciesAction, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Saved. Buyers see the change on their next page.</p>}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Currencies</legend>
        <label className="flex gap-3 items-center text-sm opacity-70">
          <input type="checkbox" checked disabled /> {storeCurrency} (your store&apos;s currency)
        </label>
        {options.map((o) => (
          <label key={o.code} className="flex gap-3 items-center text-sm">
            <input type="checkbox" name="currencies" value={o.code} defaultChecked={enabled.includes(o.code)} />
            {o.code} · {o.name}
          </label>
        ))}
      </fieldset>
      <label className="flex gap-3 items-start text-sm border-t border-border pt-4">
        <input type="checkbox" name="round" defaultChecked={round} className="mt-1" />
        <span>
          <span className="font-medium">Round converted prices to end in .99</span>
          <span className="block hint">£18.42 shows as £18.99. Buyers pay exactly what they see.</span>
        </span>
      </label>
      <SubmitButton className="btn btn-primary self-start" pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}
