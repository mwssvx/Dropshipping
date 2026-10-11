"use client";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { confirmTwoStepAction, renewCodesAction, turnOffTwoStepAction, type TwoStepState } from "../../account-actions";

/** Recovery codes, shown once. The page moves on only when they say they've kept them. */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  return (
    <div className="flex flex-col gap-3" role="status">
      <p className="banner banner-success">Done. Save these recovery codes now: they won&apos;t be shown again.</p>
      <p className="text-sm">
        If you lose your phone, each code signs you in once instead of a code from the app. Keep them somewhere safe that isn&apos;t your phone,
        like a password manager or printed out.
      </p>
      <ol aria-label="Recovery codes" className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm card p-4 max-w-sm">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false))}
        >
          {copied ? "Copied" : "Copy codes"}
        </button>
        <a className="btn btn-secondary" download="recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text + "\n")}`}>Download</a>
        <button type="button" className="btn btn-primary" onClick={() => router.refresh()}>I&apos;ve saved them</button>
      </div>
    </div>
  );
}

function useForm(fn: (s: TwoStepState, f: FormData) => Promise<TwoStepState>) {
  const [state, action, pending] = useActionState(fn, {} as TwoStepState);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };
  return { state, pending, onSubmit };
}

const CodeField = ({ id, label, hint }: { id: string; label: string; hint?: string }) => (
  <div className="field max-w-xs">
    <label className="label" htmlFor={id}>{label}</label>
    <input className="input num" id={id} name="code" required autoComplete="one-time-code" maxLength={20} spellCheck={false} />
    {hint && <span className="hint">{hint}</span>}
  </div>
);

export function ConfirmTwoStepForm() {
  const { state, pending, onSubmit } = useForm(confirmTwoStepAction);
  if (state.codes && !pending) return <RecoveryCodes codes={state.codes} />;
  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <FormError message={state.error} />
      <CodeField id="setup-code" label="Code from your app" hint="You'll be signed out on your other devices." />
      <div><button className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Checking…" : "Turn on"}</button></div>
    </form>
  );
}

export function RenewCodesForm() {
  const { state, pending, onSubmit } = useForm(renewCodesAction);
  if (state.codes && !pending) return <RecoveryCodes codes={state.codes} />;
  return (
    <form className="flex flex-col gap-3 border-t border-border pt-4" onSubmit={onSubmit} aria-labelledby="renew-heading">
      <h3 id="renew-heading" className="text-sm font-medium">New recovery codes</h3>
      <p className="hint text-sm">Used some, or not sure where they are? Make a new set. The old ones stop working.</p>
      <FormError message={state.error} />
      <CodeField id="renew-code" label="Code from your app" />
      <div><button className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Making…" : "Make new recovery codes"}</button></div>
    </form>
  );
}

export function TurnOffForm() {
  const { state, pending, onSubmit } = useForm(turnOffTwoStepAction);
  return (
    <form className="flex flex-col gap-3 border-t border-border pt-4" onSubmit={onSubmit} aria-labelledby="off-heading">
      <h3 id="off-heading" className="text-sm font-medium">Turn off</h3>
      <p className="hint text-sm">Signing in will take only your password again. We&apos;ll email you to say so.</p>
      <FormError message={state.error} />
      <div className="field max-w-xs">
        <label className="label" htmlFor="off-password">Your password</label>
        <input className="input" id="off-password" name="password" type="password" required autoComplete="current-password" />
      </div>
      <CodeField id="off-code" label="Code from your app or a recovery code" />
      <div><button className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Turning off…" : "Turn off two-step sign-in"}</button></div>
    </form>
  );
}
