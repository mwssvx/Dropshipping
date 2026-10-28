"use client";
import { useState, type ReactNode } from "react";

/** A link for the buyer to copy and send: their refer-a-friend link, or their shared saved list. */
export function ReferralCard({ id = "refer", title, body, link, stats, labels, children }: { id?: string; title: string; body: string; link: string; stats?: string | null; labels: { link: string; copy: string; copied: string }; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="card p-5 flex flex-col gap-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="font-semibold">{title}</h2>
      <p className="text-sm text-muted">{body}</p>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="field grow min-w-0">
          <label className="label" htmlFor={`${id}-link`}>{labels.link}</label>
          <input className="input w-full" id={`${id}-link`} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}>
          {copied ? labels.copied : labels.copy}
        </button>
      </div>
      {stats && <p className="text-sm hint">{stats}</p>}
      {children}
    </section>
  );
}
