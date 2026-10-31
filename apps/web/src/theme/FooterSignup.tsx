"use client";
import { useActionState, useId } from "react";

type State = { status?: "sent" | "invalid" };
type Text = { title: string; email: string; signUp: string; sent: string; invalid: string };

/**
 * The email signup in every store page's footer: the same confirm-by-email signup as the home page
 * form, answered in place so the shopper stays on the page they were reading. The editor preview
 * has no action, so its button is greyed out.
 */
export function FooterSignup({ action, text }: { action?: (s: State, f: FormData) => Promise<State>; text: Text }) {
  const id = useId();
  const [state, submit, pending] = useActionState(action ?? (async (s: State) => s), {});
  return (
    <div className="sf-footer-signup flex flex-col gap-2 max-w-md">
      <h2 className="font-semibold" id={`${id}-title`}>{text.title}</h2>
      {state.status === "sent" ? (
        <p role="status" className="text-sm font-medium">{text.sent}</p>
      ) : (
        <form action={submit} className="flex gap-2" aria-labelledby={`${id}-title`}>
          <label htmlFor={`${id}-email`} className="sr-only">{text.email}</label>
          <input id={`${id}-email`} name="email" type="email" required autoComplete="email" placeholder="you@example.com" className="input flex-1 min-w-0" />
          <button className="btn btn-primary" disabled={!action || pending}>{text.signUp}</button>
        </form>
      )}
      {state.status === "invalid" && <p role="status" className="text-sm font-medium text-critical">{text.invalid}</p>}
    </div>
  );
}
