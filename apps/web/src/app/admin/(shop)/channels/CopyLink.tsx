"use client";
import { useState } from "react";

export function CopyLink({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2 items-center">
      <input className="input num text-sm" readOnly value={url} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn btn-secondary" onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
