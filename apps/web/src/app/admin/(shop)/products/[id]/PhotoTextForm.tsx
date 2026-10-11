"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { photoTextAction, type PhotoTextState } from "../../../photo-actions";

/** A short description of what each photo shows, for screen readers and image search. */
export function PhotoTextForm({ productId, title, photos, texts, max }: { productId: string; title: string; photos: string[]; texts: Record<string, string>; max: number }) {
  const [state, action, pending] = useActionState(photoTextAction.bind(null, productId, photos.length), {} as PhotoTextState);
  return (
    // Submitted by hand so React doesn't clear what was typed after an error.
    <form
      className="flex flex-col gap-3 border-t border-border pt-4"
      aria-labelledby="photo-text-heading"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <div>
        <h3 id="photo-text-heading" className="font-medium">Describe each photo</h3>
        <p className="hint">
          Say what the photo shows, like &quot;Lamp casting an orange glow on a bedroom wall&quot;. Image search uses it, and buyers who use a screen reader hear it.
          Left empty, the photo is described as &quot;{title}&quot;.
        </p>
      </div>
      <FormError message={state.error} />
      {state.described !== undefined && !pending && !state.error && (
        <p className="banner banner-success" role="status">
          {state.described === photos.length ? "Saved. Every photo has a description." : `Saved. ${state.described} of ${photos.length} photos have a description.`}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {photos.map((src, i) => (
          <li key={`${src}|${texts[src] ?? ""}`} className="flex gap-3 items-center">
            <img src={src} alt="" className="size-12 rounded-md object-cover bg-sunken border border-border shrink-0" />
            <div className="field grow">
              <label className="label" htmlFor={`photo-text-${i}`}>Photo {i + 1}{i === 0 ? " (main)" : ""}</label>
              <input className="input" id={`photo-text-${i}`} name={`text:${i}`} maxLength={max} autoComplete="off" defaultValue={texts[src] ?? ""} />
            </div>
          </li>
        ))}
      </ul>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save descriptions"}</button>
      </div>
    </form>
  );
}
