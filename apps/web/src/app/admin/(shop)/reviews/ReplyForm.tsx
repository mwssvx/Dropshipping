"use client";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { FormError } from "@/components/FormError";
import { replyToReviewAction } from "../../growth-actions";

export type SavedReplyOption = { id: string; title: string; body: string };

const FIELD = /\{(first_name|order_number|tracking_link|store_name)\}/g;

/** A saved reply with this review's values put in; fields it has nothing for stay in braces. */
const fill = (body: string, values: Record<string, string>) => body.replace(FIELD, (field) => values[field] ?? field);
const unfilled = (text: string) => [...new Set(text.match(FIELD) ?? [])];

export function ReplyForm({ id, reply, saved = [], values = {} }: { id: string; reply: string | null; saved?: SavedReplyOption[]; values?: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [missing, setMissing] = useState<string[]>([]);
  const box = useRef<HTMLTextAreaElement>(null);
  if (!open)
    return (
      <div className="text-sm flex flex-col gap-1">
        {reply && <p className="hint border-l-2 border-border pl-3">Your reply: {reply}</p>}
        <button type="button" className="hint hover:text-ink self-start" onClick={() => setOpen(true)}>{reply ? "Edit reply" : "Reply"}</button>
      </div>
    );
  return (
    <form
      action={(f) =>
        start(async () => {
          const result = await replyToReviewAction(id, {}, f);
          setError(result.error);
          if (!result.error) setOpen(false);
        })
      }
      className="flex flex-col gap-2"
    >
      <FormError message={error} />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="label" htmlFor={`reply-${id}`}>Public reply</label>
        {saved.length > 0 ? (
          <span className="flex items-center gap-2">
            <label className="hint text-sm" htmlFor={`saved-${id}`}>Start from</label>
            <select
              id={`saved-${id}`}
              className="input py-1 text-sm w-auto"
              value=""
              onChange={(e) => {
                const pick = saved.find((s) => s.id === e.target.value);
                if (!pick || !box.current) return;
                box.current.value = fill(pick.body, values);
                box.current.focus();
                setMissing(unfilled(box.current.value));
              }}
            >
              <option value="">A saved reply…</option>
              {saved.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </span>
        ) : (
          <Link href="/admin/inbox/replies" className="hint text-sm underline">Save replies you use often</Link>
        )}
      </div>
      <textarea
        ref={box}
        className="input"
        id={`reply-${id}`}
        name="reply"
        rows={2}
        maxLength={1000}
        defaultValue={reply ?? ""}
        autoFocus
        aria-describedby={`reply-hint-${id}`}
        onChange={(e) => missing.length && setMissing(missing.filter((f) => e.target.value.includes(f)))}
      />
      {missing.length > 0 && (
        <p className="banner banner-warning text-sm" role="status">Replace {missing.join(" and ")} before saving: this review has nothing to fill it with.</p>
      )}
      <p id={`reply-hint-${id}`} className="hint text-xs">Shown under the review. The buyer gets your first reply by email once the review is published.</p>
      <div className="flex gap-2 items-center">
        <button className="btn btn-secondary" disabled={pending}>{pending ? "Saving…" : "Save reply"}</button>
        <button type="button" className="hint" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
