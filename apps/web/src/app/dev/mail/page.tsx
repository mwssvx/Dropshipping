import { notFound } from "next/navigation";
import { previewOutbox } from "@/lib/server";

export const metadata = { title: "Outbox", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Development only: emails that would have been sent. A 404 unless EMAIL_PREVIEW=on and no real mailer is set. */
export default function OutboxPage() {
  const mail = previewOutbox();
  if (!mail) notFound();
  return (
    <main className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Outbox (development)</h1>
      {mail.length === 0 && <p className="hint">Nothing sent yet.</p>}
      {mail.map((m, i) => (
        <article key={i} className="card p-4 flex flex-col gap-2" aria-label={m.subject}>
          <p className="text-sm"><span className="hint">To </span>{m.to}<span className="hint"> · {m.at.toLocaleTimeString()}</span></p>
          <h2 className="font-semibold">{m.subject}</h2>
          <pre className="whitespace-pre-wrap text-sm font-sans">{m.text}</pre>
        </article>
      ))}
    </main>
  );
}
