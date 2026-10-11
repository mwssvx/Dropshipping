"use client";
import { useActionState } from "react";
import { endOtherSignInsAction, endSignInAction, type SignInsState } from "../../account-actions";

type Item = { id: string; device: string; current: boolean; signedIn: string; lastActive: string };

function EndOne({ id, device }: { id: string; device: string }) {
  const [, action, pending] = useActionState(endSignInAction.bind(null, id), {} as SignInsState);
  return (
    <form action={action}>
      <button className="btn btn-secondary btn-sm" disabled={pending} aria-label={`Sign out ${device}`}>{pending ? "Signing out…" : "Sign out"}</button>
    </form>
  );
}

export function SignIns({ items }: { items: Item[] }) {
  const [state, action, pending] = useActionState(endOtherSignInsAction, {} as SignInsState);
  const others = items.filter((i) => !i.current).length;
  return (
    <div className="flex flex-col gap-3">
      {!!state.ended && !pending && (
        <p className="banner banner-success" role="status">Signed out of {state.ended === 1 ? "1 other device" : `${state.ended} other devices`}.</p>
      )}
      <ul className="flex flex-col divide-y divide-border" aria-label="Signed-in devices">
        {items.map((i) => (
          <li key={i.id} aria-label={i.device} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
            <div className="flex flex-col">
              <span className="text-sm font-medium flex items-center gap-2">
                {i.device}
                {i.current && <span className="pill pill-success">This device</span>}
              </span>
              <span className="hint text-sm">Signed in {i.signedIn} · {i.current ? "Active now" : i.lastActive}</span>
            </div>
            {!i.current && <EndOne id={i.id} device={i.device} />}
          </li>
        ))}
      </ul>
      {others > 1 && (
        <form action={action}>
          <button className="btn btn-secondary" disabled={pending}>{pending ? "Signing out…" : "Sign out everywhere else"}</button>
        </form>
      )}
    </div>
  );
}
