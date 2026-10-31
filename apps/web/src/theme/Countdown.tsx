"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export type CountdownLabels = { days: string; hours: string; minutes: string; seconds: string };

/**
 * A home page clock counting down to a set moment, ticking each second. It hides itself once that
 * moment passes, so a finished countdown never sits at zero on the page.
 */
export function Countdown({ endsAt, heading, text, button, labels }: {
  endsAt: string;
  heading: string;
  text: string;
  button: { label: string; href: string } | null;
  labels: CountdownLabels;
}) {
  const end = new Date(endsAt).getTime();
  // The first render matches the server's; the clock starts once the page is in the browser.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = Math.max(0, end - (now ?? Date.now()));
  if (!left) return null;
  const s = Math.floor(left / 1000);
  const parts: [number, string][] = [
    [Math.floor(s / 86_400), labels.days],
    [Math.floor(s / 3600) % 24, labels.hours],
    [Math.floor(s / 60) % 60, labels.minutes],
    [s % 60, labels.seconds],
  ];
  return (
    <section className="sf-countdown max-w-3xl mx-auto px-4 sm:px-6 py-12 flex flex-col items-center gap-5 text-center" aria-label={heading || undefined}>
      {heading && <h2 className="text-3xl font-bold tracking-tight">{heading}</h2>}
      {text && <p className="text-muted leading-relaxed whitespace-pre-line">{text}</p>}
      <div className="flex gap-3 sm:gap-4" role="timer">
        {parts.map(([n, label]) => (
          <span key={label} className="flex flex-col items-center min-w-16 sm:min-w-20 rounded-lg bg-sunken px-3 py-3">
            <span className="num text-3xl sm:text-4xl font-bold tabular-nums" suppressHydrationWarning>{String(n).padStart(2, "0")}</span>
            <span className="text-xs text-muted uppercase tracking-wide">{label}</span>
          </span>
        ))}
      </div>
      {button && <Link href={button.href} className="btn btn-primary btn-lg">{button.label}</Link>}
    </section>
  );
}
