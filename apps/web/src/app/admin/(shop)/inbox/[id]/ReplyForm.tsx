"use client";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { FormError } from "@/components/FormError";
import { inboxReplyAction } from "../../../ai-actions";

type Saved = { id: string; title: string; text: string; missing: string[] };

export function ReplyForm({ conversationId, primary, hasOrder = true, saved = [] }: { conversationId: string; primary: boolean; hasOrder?: boolean; saved?: Saved[] }) {
  const [state, action, pending] = useActionState(inboxReplyAction.bind(null, conversationId), {});
  const form = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    if (state.saved) {
      form.current?.reset();
      setMissing([]);
    }
  }, [state]);
  return (
    // Submitted by hand so React doesn't clear the reply after an error.
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
      {state.saved && !pending && !state.error && <p className="banner banner-info" role="status">{hasOrder ? "Sent by email and shown on the buyer's order page." : "Sent by email."}</p>}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="label" htmlFor="reply">Write your own reply</label>
        {saved.length > 0 ? (
          <div className="flex items-center gap-2">
            <label className="hint" htmlFor="saved-reply">Start from</label>
            <select
              id="saved-reply"
              className="input py-1 text-sm w-auto"
              value=""
              onChange={(e) => {
                const pick = saved.find((s) => s.id === e.target.value);
                if (!pick || !box.current) return;
                box.current.value = pick.text;
                box.current.focus();
                setMissing(pick.missing);
              }}
            >
              <option value="">A saved reply…</option>
              {saved.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
        ) : (
          <Link href="/admin/inbox/replies" className="hint underline">Save replies you use often</Link>
        )}
      </div>
      <textarea
        ref={box}
        id="reply"
        name="message"
        className="input"
        rows={6}
        required
        maxLength={4000}
        onChange={(e) => missing.length && setMissing(missing.filter((f) => e.target.value.includes(f)))}
      />
      {missing.length > 0 && (
        <p className="banner banner-warning" role="status">Replace {missing.join(" and ")} before sending: this conversation has nothing to fill it with yet.</p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className={`btn ${primary ? "btn-primary" : "btn-secondary"}`} disabled={pending} aria-busy={pending}>{pending ? "Sending…" : "Send reply"}</button>
        {saved.length > 0 && <Link href="/admin/inbox/replies" className="hint underline">Edit saved replies</Link>}
      </div>
    </form>
  );
}
