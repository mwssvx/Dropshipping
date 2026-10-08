"use client";
import { useRef } from "react";

/** Switches the currency prices show in; the page reloads in the new one. */
export function CurrencyPicker({ currencies, current, action }: { currencies: string[]; current: string; action: (form: FormData) => Promise<void> }) {
  const form = useRef<HTMLFormElement>(null);
  const back = useRef<HTMLInputElement>(null);
  return (
    <form ref={form} action={action} onSubmit={() => back.current && (back.current.value = location.pathname + location.search)}>
      <input ref={back} type="hidden" name="back" />
      <label className="sr-only" htmlFor="store-currency">Currency</label>
      <select id="store-currency" name="currency" defaultValue={current} className="input h-9 py-0 pr-7 text-sm w-auto"
        onChange={() => {
          if (back.current) back.current.value = location.pathname + location.search;
          form.current?.requestSubmit();
        }}>
        {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <noscript><button className="btn btn-secondary">Change</button></noscript>
    </form>
  );
}
