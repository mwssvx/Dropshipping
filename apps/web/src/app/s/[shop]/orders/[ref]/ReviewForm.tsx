"use client";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { FormError } from "@/components/FormError";
import { reviewAction, type ReviewState } from "../../actions";

export type ReviewText = { thanks: string; rewardSent: string; reviewOf: string; rating: string; stars: string[]; body: string; photos: string; photosHint: string; name: string; sending: string; send: string };

export function ReviewForm({ handle, orderRef, productId, title, name, rating, text: t }: { handle: string; orderRef: string; productId: string; title: string; name: string; rating?: number; text: ReviewText }) {
  const [state, action, pending] = useActionState(reviewAction.bind(null, handle, orderRef, productId), {} as ReviewState);
  // Stars tapped in the email are already picked, so the next thing to do is write.
  const body = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (rating !== undefined) body.current?.focus();
  }, [rating]);
  if (state.sent)
    return (
      <p className="banner banner-success" role="status">
        {t.thanks}{state.reward ? t.rewardSent : ""}
      </p>
    );
  const id = (k: string) => `${k}-${productId}`;
  return (
    // Sent by hand rather than through `action`, so React doesn't clear the stars and text when a
    // photo is refused.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-3 border-t border-border pt-4 first:border-0 first:pt-0" aria-label={t.reviewOf}>
      <p className="font-medium">{title}</p>
      <FormError message={state.error} />
      <fieldset className="flex flex-col gap-1">
        <legend className="label">{t.rating}</legend>
        <div className="flex gap-1 flex-row-reverse justify-end [&_label:has(:checked)]:text-warning [&_label:has(:checked)~label]:text-warning">
          {[5, 4, 3, 2, 1].map((n) => (
            <label key={n} className="cursor-pointer text-2xl leading-none text-border has-[:focus-visible]:outline-2">
              <input type="radio" name="rating" value={n} required defaultChecked={n === rating} className="sr-only" aria-label={t.stars[n - 1]} />
              ★
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label className="label" htmlFor={id("body")}>{t.body}</label>
        <textarea id={id("body")} name="body" className="input" rows={3} required minLength={10} maxLength={2000} ref={body} />
      </div>
      <div className="field">
        <label className="label" htmlFor={id("photos")}>{t.photos}</label>
        <input id={id("photos")} name="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" className="text-sm" aria-describedby={id("photos-hint")} />
        <span className="hint" id={id("photos-hint")}>{t.photosHint}</span>
      </div>
      <div className="field">
        <label className="label" htmlFor={id("name")}>{t.name}</label>
        <input id={id("name")} name="name" className="input" defaultValue={name} required maxLength={60} />
      </div>
      <div><button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? t.sending : t.send}</button></div>
    </form>
  );
}
