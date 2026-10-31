"use client";
import { useEffect, useRef } from "react";

/** A sort or filter menu inside a list's search form, so changing it keeps the search and other filters. */
export function AutoSubmitSelect({ id, name = "sort", label, value, options }: { id: string; name?: string; label: string; value: string; options: readonly (readonly [string, string])[] }) {
  const ref = useRef<HTMLSelectElement>(null);
  // A change made before the page's scripts loaded fired no event, so send it once they have.
  // A value the menu doesn't offer shows its first option, which isn't a change.
  useEffect(() => {
    const select = ref.current;
    if (select && select.value !== value && options.some(([v]) => v === value)) select.form?.requestSubmit();
    // Only on the first render: later changes submit through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select ref={ref} className="input w-auto" id={id} name={name} defaultValue={value} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </>
  );
}
