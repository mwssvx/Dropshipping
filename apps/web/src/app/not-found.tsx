import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="flex flex-col gap-3 items-center text-center max-w-sm">
        <p className="hint num">404</p>
        <h1 className="text-2xl font-bold">We couldn&apos;t find that page</h1>
        <p className="text-muted">The link may be old, or the page was moved or removed.</p>
        <Link href="/" className="btn btn-secondary">Go to the home page</Link>
      </div>
    </main>
  );
}
