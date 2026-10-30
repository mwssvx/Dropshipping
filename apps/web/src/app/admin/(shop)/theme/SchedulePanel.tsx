"use client";
import { useEffect, useState, useTransition } from "react";
import type { ThemeDoc } from "@sf/core/theme";
import { cancelThemeScheduleAction, keepScheduledThemeAction, scheduleThemeAction } from "../../store-actions";

export type ThemeScheduleView = { at: string; until: string | null } | null;

const spoken = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Scheduling: a copy of the draft goes live by itself at a time the merchant picks, and can
 * switch back to the look before it (a Black Friday look from Friday to Monday night). Times are
 * typed and shown in the merchant's own zone, which only the browser knows.
 */
export function SchedulePanel({ doc, schedule, setSchedule, revertAt, setRevertAt, onClose }: {
  doc: ThemeDoc;
  schedule: ThemeScheduleView;
  setSchedule: (s: ThemeScheduleView) => void;
  revertAt: string | null;
  setRevertAt: (at: string | null) => void;
  onClose: () => void;
}) {
  const [at, setAt] = useState("");
  const [until, setUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Rendered times wait for the browser, so the server and the first paint agree.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await scheduleThemeAction(doc, new Date(at).toISOString(), until ? new Date(until).toISOString() : null);
      if ("error" in r) return setError(r.error);
      setSchedule(r.schedule);
      setAt("");
      setUntil("");
    });
  };

  return (
    <section aria-label="Schedule a new look" className="px-4 sm:px-6 py-4 border-b border-border bg-sunken flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold">Schedule a new look</h2>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
      {error && <p className="banner banner-critical" role="alert">{error}</p>}
      {ready && revertAt && (
        <div className="banner banner-info flex flex-wrap items-center gap-3" role="status">
          <span className="mr-auto">The live look switches back to the one before it on {spoken(revertAt)}.</span>
          <button type="button" className="btn btn-secondary" disabled={pending}
            onClick={() => start(async () => { await keepScheduledThemeAction(); setRevertAt(null); })}>Keep this look</button>
        </div>
      )}
      {ready && schedule ? (
        <div className="banner banner-info flex flex-wrap items-center gap-3" role="status">
          <span className="mr-auto">
            Your draft as it was when you scheduled it goes live on {spoken(schedule.at)}
            {schedule.until ? `, and the look before it comes back on ${spoken(schedule.until)}.` : "."} Edits you make after that stay in the draft.
          </span>
          <button type="button" className="btn btn-secondary" disabled={pending}
            onClick={() => start(async () => { await cancelThemeScheduleAction(); setSchedule(null); })}>Cancel schedule</button>
        </div>
      ) : (
        <p className="hint">Get a holiday look ready now and it goes live by itself. Pick a time to switch back and your usual look returns after the sale.</p>
      )}
      <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="theme-at">Goes live</label>
          <input id="theme-at" className="input" type="datetime-local" required value={at} onChange={(e) => setAt(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="theme-until">Switch back (optional)</label>
          <input id="theme-until" className="input" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : schedule ? "Schedule this draft instead" : "Schedule this draft"}
        </button>
      </form>
    </section>
  );
}
