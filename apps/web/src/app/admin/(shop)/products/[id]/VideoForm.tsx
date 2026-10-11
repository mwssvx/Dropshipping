"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { productVideoAction, type VideoState } from "../../../video-actions";

/** The product page's video: a YouTube or Vimeo link, or a video file's address. */
export function VideoForm({ productId, url }: { productId: string; url: string }) {
  const [state, action, pending] = useActionState(productVideoAction.bind(null, productId), {} as VideoState);
  return (
    // Submitted by hand so React doesn't reset the field after an error.
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved !== undefined && !pending && !state.error && (
        <p className="banner banner-success" role="status">{state.saved ? "Saved. The video shows after the photos on the product page." : "Saved. This product has no video."}</p>
      )}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="field flex-1 min-w-64">
          <label className="label" htmlFor="video-url">Video link</label>
          <input className="input" id="video-url" name="video" type="url" inputMode="url" autoComplete="off" placeholder="https://www.youtube.com/watch?v=…" defaultValue={url} />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save video"}</button>
      </div>
    </form>
  );
}
