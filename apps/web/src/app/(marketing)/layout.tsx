import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { LEGAL_DOCS } from "./legal/docs";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 sm:px-8 py-5 max-w-6xl w-full mx-auto">
        <Link href="/" className="font-bold text-lg tracking-tight">{BRAND}</Link>
        <nav className="flex gap-2 items-center" aria-label="Main">
          <Link href="/pricing" className="px-3 py-2 text-sm font-medium hover:text-accent">Pricing</Link>
          <Link href="/login" className="btn btn-secondary">Sign in</Link>
          <Link href="/signup" className="btn btn-primary hidden sm:inline-flex">Start free</Link>
        </nav>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-border mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 flex flex-col sm:flex-row gap-4 justify-between text-sm">
          <span className="hint">© {new Date().getFullYear()} {BRAND}</span>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Footer">
            <Link className="hint hover:text-ink" href="/pricing">Pricing</Link>
            {LEGAL_DOCS.map((d) => (
              <Link key={d.slug} className="hint hover:text-ink" href={`/legal/${d.slug}`}>{d.short}</Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
