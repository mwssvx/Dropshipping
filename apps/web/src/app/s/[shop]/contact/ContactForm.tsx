"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import type { ContactState } from "../actions";

type Text = { name: string; email: string; order: string; message: string; send: string; sending: string; sent: string };

/** Name, email, an optional order number and the message. Fields stay filled after an error. */
export function ContactForm({ action, text }: { action: (state: ContactState, form: FormData) => Promise<ContactState>; text: Text }) {
  const [state, submit, pending] = useActionState(action, {} as ContactState);
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
          <label className="label" htmlFor="contact-name">{text.name}</label>
          <input className="input" id="contact-name" name="name" required maxLength={100} autoComplete="name" />
        </div>
        <div className="field">
          <label className="label" htmlFor="contact-email">{text.email}</label>
          <input className="input" id="contact-email" name="email" type="email" required autoComplete="email" />
        </div>
      </div>
      <div className="field sm:max-w-xs">
        <label className="label" htmlFor="contact-order">{text.order}</label>
        <input className="input num" id="contact-order" name="order" inputMode="numeric" maxLength={20} placeholder="#1001" />
      </div>
      <div className="field">
        <label className="label" htmlFor="contact-message">{text.message}</label>
        <textarea className="input" id="contact-message" name="message" required minLength={10} maxLength={4000} rows={6} />
      </div>
      {/* Hidden from people; bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? text.sending : text.send}</button>
      </div>
    </form>
  );
}
