"use client";
import { useState } from "react";

/** The buyer's refer-a-friend link, on their order page and account. */
export function ReferralCard({ title, body, link, stats, labels }: { title: string; body: string; link: string; stats?: string | null; labels: { link: string; copy: string; copied: string } }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="card p-5 flex flex-col gap-3" aria-labelledby="refer-heading">
      <h2 id="refer-heading" className="font-semibold">{title}</h2>
      <p className="text-sm text-muted">{body}</p>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="field grow min-w-0">
          <label className="label" htmlFor="refer-link">{labels.link}</label>
          <input className="input w-full" id="refer-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}>
          {copied ? labels.copied : labels.copy}
        </button>
      </div>
      {stats && <p className="text-sm hint">{stats}</p>}
    </section>
  );
}
