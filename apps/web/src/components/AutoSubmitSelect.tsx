"use client";

/** A sort or filter menu inside a list's search form, so changing it keeps the search and other filters. */
export function AutoSubmitSelect({ id, name = "sort", label, value, options }: { id: string; name?: string; label: string; value: string; options: readonly (readonly [string, string])[] }) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select className="input w-auto" id={id} name={name} defaultValue={value} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </>
  );
}
