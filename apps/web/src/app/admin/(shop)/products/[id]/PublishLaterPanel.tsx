"use client";
import { startTransition, useActionState, useEffect, useState } from "react";
import { FormError } from "@/components/FormError";
import { publishLaterAction, type PublishLaterState } from "../../../publish-actions";

/** A datetime-local value for an exact time, in the merchant's own time zone. */
function localValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const spoken = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A draft that goes on sale by itself at a chosen time. */
export function PublishLaterPanel({ productId, title, publishAt }: { productId: string; title: string; publishAt: string | null }) {
  const [state, action, pending] = useActionState(publishLaterAction.bind(null, productId, title), {} as PublishLaterState);
  const [local, setLocal] = useState("");
  // Times are shown in the merchant's own zone, which only the browser knows.
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    setLocal(publishAt ? localValue(publishAt) : "");
    setShown(publishAt ? spoken(publishAt) : null);
  }, [publishAt]);
  const send = (value: string) => {
    const data = new FormData();
    data.set("publishAt", value ? new Date(value).toISOString() : "");
    startTransition(() => action(data));
  };
  return (
    <div className="flex flex-col gap-3">
      <FormError message={state.error} />
      {publishAt && shown ? (
        <p className="banner banner-info" role="status">Goes on sale by itself on {shown}. Until then buyers can&apos;t see it.</p>
      ) : (
        state.saved === "cleared" && !pending && <p className="banner banner-success" role="status">Cancelled. It stays a draft until you put it on sale.</p>
      )}
      <form
        className="flex flex-wrap gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          send(local);
        }}
      >
        <div className="field">
          <label className="label" htmlFor="publish-at">Goes on sale</label>
          <input className="input" id="publish-at" type="datetime-local" required value={local} onChange={(e) => setLocal(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : publishAt ? "Change time" : "Schedule"}</button>
        {publishAt && (
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => send("")}>Cancel schedule</button>
        )}
      </form>
    </div>
  );
}
