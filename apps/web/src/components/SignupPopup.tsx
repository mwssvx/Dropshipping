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

/** The visitor has been on the page this long before leaving counts, so a quick look at the tabs on arrival doesn't open it. */
const LEAVE_AFTER_MS = 3000;

/**
 * Asks new visitors for their email a few seconds after they arrive, once. Closing it or signing up
 * hides it for good. With `seconds` 0 it waits until the mouse leaves through the top of the window,
 * as if heading for the tabs or address bar; without a mouse (phones) it opens after `leaveFallback` seconds.
 */
export function SignupPopup({ shopId, seconds, leaveFallback, quiet, action, text }: { shopId: string; seconds: number; leaveFallback: number; quiet: string; action: (s: State, f: FormData) => Promise<State>; text: Text }) {
  const ref = useRef<HTMLDialogElement>(null);
  // The store layout stays put while the shopper moves between pages, so check the page when it's time.
  const path = useRef("");
  path.current = usePathname();
  const [state, submit, pending] = useActionState(action, {});
  useEffect(() => {
    if (seen(shopId)) return;
    const open = () => {
      // Not on the cart, checkout or account pages, and not over another dialog the shopper opened.
      if (new RegExp(quiet).test(path.current) || document.querySelector("dialog[open]") || ref.current?.open) return false;
      ref.current?.showModal();
      return true;
    };
    const mouse = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (seconds > 0 || !mouse) {
      const timer = setTimeout(open, (seconds > 0 ? seconds : leaveFallback) * 1000);
      return () => clearTimeout(timer);
    }
    const since = Date.now();
    const leaving = (e: MouseEvent) => {
      if (e.relatedTarget || e.clientY > 0 || Date.now() - since < LEAVE_AFTER_MS) return;
      if (open()) document.removeEventListener("mouseout", leaving);
    };
    document.addEventListener("mouseout", leaving);
    return () => document.removeEventListener("mouseout", leaving);
  }, [shopId, seconds, leaveFallback, quiet]);
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
