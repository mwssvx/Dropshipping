"use client";
import { usePathname } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";

type State = { status?: "sent" | "invalid" };
type Text = { title: string; text: string; offer: string | null; email: string; signUp: string; noThanks: string; close: string; sent: string; invalid: string };

const key = (shopId: string) => `sf-signup-popup-${shopId}`;
function seen(shopId: string) {
  try {
    return localStorage.getItem(key(shopId)) === "1";
  } catch {
    return true;
  }
}
function remember(shopId: string) {
  try {
    localStorage.setItem(key(shopId), "1");
  } catch {}
}

/** Asks new visitors for their email a few seconds after they arrive, once. Closing it or signing up hides it for good. */
export function SignupPopup({ shopId, seconds, quiet, action, text }: { shopId: string; seconds: number; quiet: string; action: (s: State, f: FormData) => Promise<State>; text: Text }) {
  const ref = useRef<HTMLDialogElement>(null);
  // The store layout stays put while the shopper moves between pages, so check the page when it's time.
  const path = useRef("");
  path.current = usePathname();
  const [state, submit, pending] = useActionState(action, {});
  useEffect(() => {
    if (seen(shopId)) return;
    const timer = setTimeout(() => {
      // Not on the cart, checkout or account pages, and not over another dialog the shopper opened.
      if (new RegExp(quiet).test(path.current) || document.querySelector("dialog[open]")) return;
      ref.current?.showModal();
    }, seconds * 1000);
    return () => clearTimeout(timer);
  }, [shopId, seconds, quiet]);
  useEffect(() => {
    if (state.status === "sent") remember(shopId);
  }, [state.status, shopId]);
  const close = () => {
    remember(shopId);
    ref.current?.close();
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby="signup-popup-title"
      className="card p-6 max-w-[calc(100vw-2rem)] w-[26rem] m-auto backdrop:bg-black/40"
      onClose={() => remember(shopId)}
      onClick={(e) => e.target === ref.current && close()}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <h2 id="signup-popup-title" className="text-xl font-bold tracking-tight">{text.title}</h2>
          <button type="button" className="hint hover:text-ink text-xl leading-none" aria-label={text.close} onClick={close}>×</button>
        </div>
        {text.offer && state.status !== "sent" && <p className="font-medium">{text.offer}</p>}
        <p className="text-sm text-muted">{text.text}</p>
        {state.status && <p role="status" className={`text-sm font-medium ${state.status === "invalid" ? "text-critical" : ""}`}>{state.status === "sent" ? text.sent : text.invalid}</p>}
        {state.status !== "sent" ? (
          <form action={submit} className="flex flex-col gap-2">
            <label htmlFor="signup-popup-email" className="sr-only">{text.email}</label>
            <input id="signup-popup-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className="input" />
            <button className="btn btn-primary" disabled={pending} aria-busy={pending}>{text.signUp}</button>
            <button type="button" className="btn btn-secondary" onClick={close}>{text.noThanks}</button>
          </form>
        ) : (
          <button type="button" className="btn btn-secondary self-start" onClick={close}>{text.close}</button>
        )}
      </div>
    </dialog>
  );
}
