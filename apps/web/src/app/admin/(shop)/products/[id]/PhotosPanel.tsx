"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { photoAction } from "../../../photo-actions";
import { PhotoTextForm } from "./PhotoTextForm";

/** The product's photos in order, with buttons to reorder, remove and add. The first is the main photo. */
export function PhotosPanel({ productId, title, photos, texts, max, textMax }: { productId: string; title: string; photos: string[]; texts: Record<string, string>; max: number; textMax: number }) {
  const [state, action] = useActionState(photoAction.bind(null, productId), {});
  const full = photos.length >= max;
  return (
    <section className="card p-5 flex flex-col gap-4 max-w-3xl" aria-labelledby="photos-heading">
      <div>
        <h2 id="photos-heading" className="font-semibold">Photos</h2>
        <p className="hint">The first photo shows in lists, carts and search. Buyers can flip through the rest on the product page. Up to {max}.</p>
      </div>
      <FormError message={state.error} />
      {state.message && <p role="status" className="banner banner-info">{state.message}</p>}
      {photos.length > 0 ? (
        <form action={action}>
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {photos.map((src, i) => (
            <li key={src} className="flex flex-col gap-2">
              <div className="relative aspect-square rounded-lg bg-sunken overflow-hidden border border-border">
                <img src={src} alt={texts[src] || `${title}, photo ${i + 1}`} className="size-full object-cover" />
                {i === 0 && <span className="pill pill-info absolute top-2 left-2">Main</span>}
              </div>
              <div className="flex flex-wrap gap-1 text-xs">
                {i > 0 && <button className="btn btn-secondary btn-sm" name="op" value={`cover:${i}`} aria-label={`Make photo ${i + 1} the main photo`}>Main</button>}
                {i > 0 && <button className="btn btn-secondary btn-sm" name="op" value={`earlier:${i}`} aria-label={`Move photo ${i + 1} earlier`}>←</button>}
                {i < photos.length - 1 && <button className="btn btn-secondary btn-sm" name="op" value={`later:${i}`} aria-label={`Move photo ${i + 1} later`}>→</button>}
                <button className="btn btn-secondary btn-sm" name="op" value={`remove:${i}`} aria-label={`Remove photo ${i + 1}`}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
        </form>
      ) : (
        <p className="hint">No photos yet. Products with photos sell much better.</p>
      )}
      {photos.length > 0 && <PhotoTextForm productId={productId} title={title} photos={photos} texts={texts} max={textMax} />}
      {full ? (
        <p className="hint">That&apos;s the most photos a product can have. Remove one to add another.</p>
      ) : (
        <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end border-t border-border pt-4">
          <div className="field">
            <label className="label" htmlFor="photo-file">Upload a photo</label>
            <input className="input" id="photo-file" name="file" type="file" accept="image/jpeg,image/png,image/webp" />
          </div>
          <div className="field">
            <label className="label" htmlFor="photo-url">Or paste its address</label>
            <input className="input" id="photo-url" name="url" type="url" key={state.url ?? ""} defaultValue={state.url ?? ""} placeholder="https://…" />
          </div>
          <input type="hidden" name="op" value="add" />
          <SubmitButton className="btn btn-secondary" pendingText="Adding…">Add photo</SubmitButton>
        </form>
      )}
    </section>
  );
}
