"use client";

/** Ticks or clears every order's box on the list. */
export function SelectAll({ form }: { form: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Pick all orders shown"
      onChange={(e) => {
        for (const box of document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name=ids][form=${form}]`)) box.checked = e.target.checked;
      }}
    />
  );
}
