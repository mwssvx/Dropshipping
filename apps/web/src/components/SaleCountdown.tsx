"use client";
import { useEffect, useState } from "react";

/**
 * The time left in a sale, ticking each second: "Ends in 2 days 04:12:33". It counts to the sale's
 * real end, and once that passes it says the sale has ended (the next page load shows full prices).
 */
export function SaleCountdown({ endsAt, lang, text, className }: { endsAt: string; lang: string; text: { endsIn: string; ended: string }; className?: string }) {
  const end = new Date(endsAt).getTime();
  // The first render matches the server's; the clock starts once the page is in the browser.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, end - (now ?? Date.now()));
  if (now !== null && left === 0) return <span className={className}>{text.ended}</span>;
  const s = Math.floor(left / 1000);
  const days = Math.floor(s / 86_400);
  const clock = [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
  const dayText = days ? `${new Intl.NumberFormat(lang, { style: "unit", unit: "day", unitDisplay: "long" }).format(days)} ` : "";
  return (
    <span className={className} role="timer" suppressHydrationWarning>
      {text.endsIn.split("%s").join(`${dayText}${clock}`)}
    </span>
  );
}
