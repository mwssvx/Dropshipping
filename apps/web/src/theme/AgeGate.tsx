"use client";
import { useEffect, useRef, useState } from "react";

export type AgeGateText = { title: string; intro: string; question: string; yes: string; no: string; denied: string };

const remember = (key: string, age: number) => {
  try {
    localStorage.setItem(key, String(age));
  } catch {
    // Private windows can refuse storage; the visitor is just asked again next time.
  }
};
const remembered = (key: string) => {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
};

/**
 * Asks visitors to confirm their age before they see a store that sells to adults only. A "yes"
 * is remembered on this device; a "no" isn't, so a slip of the finger is fixed by reloading.
 * It's a confirmation, not a check: checkout still asks per product and couriers check ID.
 */
export function AgeGate({ age, storeKey, text }: { age: 18 | 21; storeKey: string; text: AgeGateText }) {
  const key = `sf-age:${storeKey}`;
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<"checking" | "asking" | "denied" | "ok">("checking");
  // Storage is only readable in the browser, so the first render shows nothing either way.
  useEffect(() => setState(remembered(key) >= age ? "ok" : "asking"), [key, age]);
  useEffect(() => {
    if (state === "asking" && !ref.current?.open) ref.current?.showModal();
  }, [state]);
  if (state === "ok" || state === "checking") return null;
  return (
    <dialog ref={ref} aria-labelledby="sf-age-title" aria-describedby="sf-age-intro"
      onCancel={(e) => e.preventDefault()}
      className="sf-age-gate m-auto max-w-md w-[calc(100%-2rem)] rounded-lg bg-surface text-ink p-6 shadow-xl backdrop:bg-black/80">
      <div className="flex flex-col gap-4 text-center">
        <h2 id="sf-age-title" className="text-2xl font-bold tracking-tight">{text.title}</h2>
        <p id="sf-age-intro" className="text-muted">{state === "denied" ? text.denied : text.intro}</p>
        {state === "asking" && (
          <>
            <p className="text-lg font-semibold">{text.question}</p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <button type="button" className="btn btn-primary btn-lg" autoFocus
                onClick={() => { remember(key, age); ref.current?.close(); setState("ok"); }}>{text.yes}</button>
              <button type="button" className="btn btn-secondary btn-lg" onClick={() => setState("denied")}>{text.no}</button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
