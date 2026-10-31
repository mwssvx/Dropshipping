"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * "Delivering to United States · Change": the shopper picks the country shipping costs, delivery
 * dates and duties are shown for, when where they are (or their VPN) isn't where it's going. Kept
 * in a cookie, so the cart and checkout follow it.
 */
export function DeliverTo({ current, countries, text }: { current: string; countries: [string, string][]; text: { deliveringTo: string; change: string; deliverTo: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (open) {
    return (
      <p className="text-sm flex items-center gap-2 flex-wrap" id="deliver-to">
        <label htmlFor="deliver-to-country" className="hint">{text.deliverTo}</label>
        <select
          id="deliver-to-country"
          className="input w-auto"
          defaultValue={current}
          disabled={pending}
          onChange={(e) => {
            document.cookie = `sf_country=${e.target.value}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
            start(() => {
              setOpen(false);
              router.refresh();
            });
          }}
        >
          {countries.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </p>
    );
  }
  return (
    <p className="text-sm hint" id="deliver-to">
      {text.deliveringTo} ·{" "}
      <button type="button" className="underline" onClick={() => setOpen(true)}>{text.change}</button>
    </p>
  );
}
