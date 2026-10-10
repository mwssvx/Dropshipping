"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { variantPhotosAction } from "../../../photo-actions";

/**
 * Which photo buyers see when they pick an option: one row per colour (or per option when the
 * product isn't split by colour), each a choice of the product's photos.
 */
export function VariantPhotosPanel({ productId, option, rows, photos }: { productId: string; option: string | null; rows: { key: string; label: string; url: string | null }[]; photos: string[] }) {
  const [state, action] = useActionState(variantPhotosAction.bind(null, productId, option), {});
  // Remount with the saved choices after each save.
  const saved = rows.map((r) => r.url ?? "").join("|");
  return (
    <section className="card p-5 flex flex-col gap-4 max-w-3xl" aria-labelledby="variant-photos-heading">
      <div>
        <h2 id="variant-photos-heading" className="font-semibold">{option ? `Photo for each ${option.toLowerCase()}` : "Photo for each option"}</h2>
        <p className="hint">When a buyer picks one, the product page switches to its photo, and the cart shows it too.</p>
      </div>
      <FormError message={state.error} />
      {state.message && <p role="status" className="banner banner-info">{state.message}</p>}
      <form action={action} key={saved} className="flex flex-col gap-4">
        {rows.map((r) => (
          <fieldset key={r.key} className="flex flex-col gap-2">
            <legend className="label mb-1">{r.label}</legend>
            <div className="flex flex-wrap gap-2">
              <label className="chip">
                <input type="radio" name={`photo:${r.key}`} value="" defaultChecked={!r.url} className="sr-only peer" />
                <span>Main photo</span>
              </label>
              {photos.map((src, i) => (
                <label key={src} className="relative cursor-pointer">
                  <input type="radio" name={`photo:${r.key}`} value={src} defaultChecked={r.url === src} className="sr-only peer" aria-label={`${r.label}: photo ${i + 1}`} />
                  <img src={src} alt="" className="size-14 rounded-lg object-cover border-2 border-transparent peer-checked:border-ink peer-focus-visible:outline peer-focus-visible:outline-2" />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <SubmitButton className="btn btn-secondary self-start" pendingText="Saving…">Save photos</SubmitButton>
      </form>
    </section>
  );
}
