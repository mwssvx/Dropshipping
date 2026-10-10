"use client";
import { useState, type ReactNode } from "react";

export type PickerVariant = { id: string; title: string; options: Record<string, string>; available: boolean };

/**
 * One row of choices per option (Size, Color) instead of a list of every combination. Picking a
 * value that doesn't go with the other choices moves them to the nearest combination in stock,
 * and values with nothing left in stock can't be picked. The chosen option goes in the form as
 * variantId, like the plain list.
 */
export function OptionPicker({
  options,
  variants,
  initialId,
  prices,
  soldOutLabel,
}: {
  options: { name: string; values: string[] }[];
  variants: PickerVariant[];
  initialId: string;
  prices: Record<string, ReactNode>;
  soldOutLabel: string;
}) {
  const [chosenId, setChosenId] = useState(initialId);
  const chosen = variants.find((v) => v.id === chosenId) ?? variants[0]!;

  const find = (picks: Record<string, string>) => variants.find((v) => options.every((o) => v.options[o.name] === picks[o.name]));
  /** The best in-stock variant with this value: keep as many of the other choices as possible. */
  function pick(name: string, value: string) {
    const exact = find({ ...chosen.options, [name]: value });
    if (exact?.available) return setChosenId(exact.id);
    const score = (v: PickerVariant) => options.filter((o) => o.name !== name && v.options[o.name] === chosen.options[o.name]).length;
    const best = variants.filter((v) => v.available && v.options[name] === value).sort((a, b) => score(b) - score(a))[0];
    setChosenId((best ?? exact ?? chosen).id);
  }

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="variantId" value={chosen.id} />
      {options.map((o) => (
        <fieldset key={o.name} className="flex flex-col gap-2">
          <legend className="label mb-2">
            {o.name}: <span className="font-normal">{chosen.options[o.name]}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {o.values.map((value) => {
              const anyInStock = variants.some((v) => v.available && v.options[o.name] === value);
              // In stock with the other current choices, or only after changing them.
              const withChoices = find({ ...chosen.options, [o.name]: value })?.available ?? false;
              return (
                <label key={value} className={`chip ${!anyInStock ? "opacity-50 line-through" : !withChoices ? "opacity-70" : ""}`}>
                  <input
                    type="radio"
                    name={`pick-${o.name}`}
                    value={value}
                    checked={chosen.options[o.name] === value}
                    disabled={!anyInStock}
                    onChange={() => pick(o.name, value)}
                    className="sr-only peer"
                    aria-describedby={!anyInStock ? `soldout-${o.name}-${value}` : undefined}
                  />
                  <span>{value}</span>
                  {!anyInStock && <span id={`soldout-${o.name}-${value}`} className="sr-only">{soldOutLabel}</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      <p className="text-sm flex gap-2 items-baseline" aria-live="polite">
        <span>{chosen.title}</span>
        {prices[chosen.id]}
        {!chosen.available && <span className="text-critical">{soldOutLabel}</span>}
      </p>
    </div>
  );
}
