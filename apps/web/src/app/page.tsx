import Link from "next/link";
import { BRAND } from "@/lib/brand";

export default function Home() {
  return (
    <main className="min-h-dvh flex flex-col">
      <header className="flex items-center justify-between px-4 sm:px-8 py-5 max-w-6xl w-full mx-auto">
        <span className="font-bold text-lg tracking-tight">{BRAND}</span>
        <nav className="flex gap-2">
          <Link href="/login" className="btn btn-secondary">Sign in</Link>
          <Link href="/signup" className="btn btn-primary">Start free</Link>
        </nav>
      </header>
      <section className="flex-1 px-4 sm:px-8 py-16 max-w-6xl w-full mx-auto grid gap-10 lg:grid-cols-[1.2fr_1fr] items-center">
        <div className="flex flex-col gap-6">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05]">
            Run a dropshipping store without paying for ten apps.
          </h1>
          <p className="text-lg text-muted max-w-xl">
            Supplier import, automatic fulfilment and AI agents that do the busywork are built in, for one price.
            When something needs you, you see why, on the web or in the app.
          </p>
          <div className="flex gap-3 flex-wrap">
            <Link href="/signup" className="btn btn-primary btn-lg">Open your store</Link>
          </div>
        </div>
        <ul className="card p-6 flex flex-col gap-4 text-sm">
          {[
            ["Built in, not bolted on", "Import, fulfilment, reviews and email included."],
            ["Never in the dark", "Every payout hold shows its reason, what we need, and when it clears."],
            ["Agents do, you decide", "AI handles routine work and asks before anything that matters."],
            ["Yours to take", "Export everything in one click. Standard web themes."],
          ].map(([t, d]) => (
            <li key={t} className="flex flex-col gap-1">
              <span className="font-semibold">{t}</span>
              <span className="text-muted">{d}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
