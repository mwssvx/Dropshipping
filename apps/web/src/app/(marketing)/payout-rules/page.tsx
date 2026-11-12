import Link from "next/link";
import { PAYOUT_RULES } from "@sf/core";

export const metadata = {
  title: "Payout rules",
  description: "When your money arrives, what can pause a payout, and what we promise when it happens.",
};

/** The payout rules every store is held to, public so sellers read them before they sign up. */
export default function PayoutRulesPage() {
  return (
    <main className="px-4 sm:px-8 pb-12 max-w-3xl mx-auto flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight">Payout rules</h1>
        <p className="text-lg text-muted">
          No surprises with your money. Here&apos;s when it arrives, what can pause it, and what we do when that happens.
        </p>
      </div>
      {PAYOUT_RULES.map((section) => (
        <section key={section.heading} className="flex flex-col gap-2" aria-label={section.heading}>
          <h2 className="text-xl font-semibold">{section.heading}</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            {section.points.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </section>
      ))}
      <p className="hint">
        Questions about a payout? Ask the assistant in your admin, or ask for a person. <Link className="underline" href="/signup">Start free</Link>
      </p>
    </main>
  );
}
