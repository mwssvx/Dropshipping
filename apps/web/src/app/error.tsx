"use client";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="flex flex-col gap-3 items-center text-center max-w-sm">
        <h1 className="text-2xl font-bold">Something went wrong on our side</h1>
        <p className="text-muted">Nothing you did caused this, and nothing was lost. Try again; if it keeps happening, tell us the code below.</p>
        {error.digest && <code className="hint">{error.digest}</code>}
        <button className="btn btn-primary" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
