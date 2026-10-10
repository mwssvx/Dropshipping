"use client";
import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

export type AddonChoice = { id: string; title: string; priceLabel: string; wasLabel: string | null };

/** The checkout add-on: one product, its options, and a button that adds it in place. */
export function AddonOffer({ action, heading, title, pitch, imageUrl, save, optionLabel, choices, addLabel }: {
  action: (form: FormData) => void | Promise<void>;
  heading: string;
  title: string;
  pitch: string | null;
  imageUrl: string | null;
  save: string | null;
  optionLabel: string;
  choices: AddonChoice[];
  addLabel: Record<string, string>;
}) {
  const [variantId, setVariantId] = useState(choices[0]!.id);
  const pick = choices.find((c) => c.id === variantId) ?? choices[0]!;
  return (
    <section className="border-t border-border pt-4 flex flex-col gap-3" aria-labelledby="addon-heading">
      <h3 id="addon-heading" className="font-semibold text-sm">{heading}</h3>
      <form action={action} className="flex gap-3 items-start">
        {imageUrl ? <img src={imageUrl} alt="" className="size-14 rounded-md object-cover bg-surface shrink-0" /> : <span className="size-14 rounded-md bg-surface shrink-0" aria-hidden />}
        <div className="flex flex-col gap-1.5 min-w-0 text-sm">
          <p className="font-medium">{title}</p>
          {pitch && <p className="hint">{pitch}</p>}
          <p className="num">
            <span className="font-semibold">{pick.priceLabel}</span>
            {pick.wasLabel && <s className="hint ml-1.5">{pick.wasLabel}</s>}
            {save && <span className="text-success ml-1.5">{save}</span>}
          </p>
          {choices.length > 1 ? (
            <select className="input text-sm" name="variantId" aria-label={optionLabel} value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          ) : (
            <input type="hidden" name="variantId" value={variantId} />
          )}
          <SubmitButton className="btn btn-secondary btn-sm self-start" pendingText={addLabel[variantId]}>{addLabel[variantId]}</SubmitButton>
        </div>
      </form>
    </section>
  );
}
