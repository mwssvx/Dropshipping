"use client";
import { startTransition, useActionState, useId } from "react";
import { FormError } from "@/components/FormError";
import type { ContactState } from "../actions";

type Text = { name: string; email: string; order: string; message: string; send: string; sending: string; sent: string };

const nothing = async (state: ContactState) => state;

/**
 * Name, email, an optional order number and the message. Fields stay filled after an error.
 * Without an action (the theme editor's preview) the button can't be pressed.
 */
export function ContactForm({ action, text }: { action?: (state: ContactState, form: FormData) => Promise<ContactState>; text: Text }) {
  const [state, submit, pending] = useActionState(action ?? nothing, {} as ContactState);
  const id = useId();
  if (state.sent) return <p className="banner banner-success" role="status">{text.sent}</p>;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => submit(data));
      }}
    >
      <FormError message={state.error} />
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="field">
          <label className="label" htmlFor={`${id}-name`}>{text.name}</label>
          <input className="input" id={`${id}-name`} name="name" required maxLength={100} autoComplete="name" />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${id}-email`}>{text.email}</label>
          <input className="input" id={`${id}-email`} name="email" type="email" required autoComplete="email" />
        </div>
      </div>
      <div className="field sm:max-w-xs">
        <label className="label" htmlFor={`${id}-order`}>{text.order}</label>
        <input className="input num" id={`${id}-order`} name="order" inputMode="numeric" maxLength={20} placeholder="#1001" />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${id}-message`}>{text.message}</label>
        <textarea className="input" id={`${id}-message`} name="message" required minLength={10} maxLength={4000} rows={6} />
      </div>
      {/* Hidden from people; bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending || !action} aria-busy={pending}>{pending ? text.sending : text.send}</button>
      </div>
    </form>
  );
}
