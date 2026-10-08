"use client";
import { useState, useTransition } from "react";
import { replyToReviewAction } from "../../growth-actions";

export function ReplyForm({ id, reply }: { id: string; reply: string | null }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <div className="text-sm flex flex-col gap-1">
        {reply && <p className="hint border-l-2 border-border pl-3">Your reply: {reply}</p>}
        <button type="button" className="hint hover:text-ink self-start" onClick={() => setOpen(true)}>{reply ? "Edit reply" : "Reply"}</button>
      </div>
    );
  return (
    <form
      action={(f) => start(async () => { await replyToReviewAction(id, {}, f); setOpen(false); })}
      className="flex flex-col gap-2"
    >
      <label className="label" htmlFor={`reply-${id}`}>Public reply</label>
      <textarea className="input" id={`reply-${id}`} name="reply" rows={2} maxLength={1000} defaultValue={reply ?? ""} autoFocus />
      <div className="flex gap-2 items-center">
        <button className="btn btn-secondary" disabled={pending}>{pending ? "Saving…" : "Save reply"}</button>
        <button type="button" className="hint" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
