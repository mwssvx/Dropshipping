"use client";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { FormError } from "@/components/FormError";
import { savedReplyAction, type SavedReplyState } from "../../../saved-reply-actions";

/** A new saved reply, or one being changed. */
export function SavedReplyForm({ reply }: { reply?: { id: string; title: string; body: string } }) {
  const [state, action, pending] = useActionState(savedReplyAction, {} as SavedReplyState);
  const form = useRef<HTMLFormElement>(null);
  const key = reply?.id ?? "new";
  // A new reply's form empties once it's saved; an edited one keeps what was saved.
  useEffect(() => {
    if (state.saved && !reply) form.current?.reset();
  }, [state, reply]);
  return (
    // Submitted by hand so React doesn't clear the fields after an error.
    <form
      ref={form}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved && !pending && !state.error && <p className="banner banner-success" role="status">Saved “{state.saved}”.</p>}
      {reply && <input type="hidden" name="id" value={reply.id} />}
      <div className="field">
        <label className="label" htmlFor={`title-${key}`}>Name</label>
        <input className="input" id={`title-${key}`} name="title" maxLength={60} defaultValue={reply?.title} placeholder="Where is my order" autoComplete="off" />
      </div>
      <div className="field">
        <label className="label" htmlFor={`body-${key}`}>Reply</label>
        <textarea className="input" id={`body-${key}`} name="body" rows={5} maxLength={2000} defaultValue={reply?.body} />
      </div>
      <div>
        <button type="submit" className={`btn ${reply ? "btn-secondary" : "btn-primary"}`} disabled={pending} aria-busy={pending}>{pending ? "Saving…" : reply ? "Save changes" : "Add reply"}</button>
      </div>
    </form>
  );
}
