"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { setChatButtonsAction } from "../../chat-actions";

export function ChatButtonsForm({ whatsapp, telegram }: { whatsapp: string | null; telegram: string | null }) {
  const [state, action] = useActionState(setChatButtonsAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label className="label" htmlFor="whatsapp">WhatsApp number</label>
          <input className="input" id="whatsapp" name="whatsapp" type="tel" inputMode="tel" defaultValue={whatsapp ? `+${whatsapp}` : ""} placeholder="+44 7700 900123" />
        </div>
        <div className="field">
          <label className="label" htmlFor="telegram">Telegram username</label>
          <input className="input" id="telegram" name="telegram" defaultValue={telegram ? `@${telegram}` : ""} placeholder="@yourstore" autoComplete="off" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton className="btn btn-primary" pendingText="Saving…">Save chat buttons</SubmitButton>
        {state.saved && <p role="status" className="text-sm">Saved.</p>}
      </div>
    </form>
  );
}
