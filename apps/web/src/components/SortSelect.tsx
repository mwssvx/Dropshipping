"use client";

/** A sort menu inside a list's search form, so changing it keeps the search and filters. */
export function SortSelect({ id, label, value, options }: { id: string; label: string; value: string; options: readonly (readonly [string, string])[] }) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select className="input w-auto" id={id} name="sort" defaultValue={value} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </>
  );
}
