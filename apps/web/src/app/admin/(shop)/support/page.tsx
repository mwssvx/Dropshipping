import Link from "next/link";
import { formatWait, listTickets, PLANS, SUPPORT_HOURS } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { NewTicketForm, TicketReplyForm } from "./SupportForms";

export const metadata = { title: "Help from a person" };

const when = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const WHO: Record<string, string> = { merchant: "You", staff: "Our team", agent: "Assistant", buyer: "Buyer" };

export default async function SupportPage() {
  const { db, shop } = await requireShop();
  const now = new Date();
  const { hours, plan, tickets } = await listTickets(db, shop.id, now);
  return (
    <main className="pb-12">
      <PageHeader title="Help from a person" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="promise">
          <h2 id="promise" className="font-semibold">Our promise</h2>
          <p className="text-sm">
            A real person from our team answers within <span className="font-semibold">{formatWait(hours * 60)}</span>, any day of the week, on
            the {PLANS[plan].name} plan. Not a bot, and not a link to a help article. If we&apos;re late, you&apos;ll see it here.
          </p>
          {plan !== "scale" && (
            <p className="hint text-sm">
              Growth answers within {SUPPORT_HOURS.growth} hours and Scale within {SUPPORT_HOURS.scale}. <Link className="underline" href="/admin/plan">See plans</Link>
            </p>
          )}
          <p className="hint text-sm">For quick questions about your store, your assistant answers straight away and can hand over to us too.</p>
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="new-ticket">
          <h2 id="new-ticket" className="font-semibold">Write to our team</h2>
          <NewTicketForm />
        </section>

        {tickets.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="your-requests">
            <h2 id="your-requests" className="font-semibold">Your requests</h2>
            {tickets.map(({ ticket: t, messages, wait }) => (
              <article key={t.id} className="card p-5 flex flex-col gap-3" aria-label={t.subject}>
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="font-semibold">{t.subject}</h3>
                  {t.status === "resolved" ? (
                    <span className="pill pill-success">Answered</span>
                  ) : wait ? (
                    wait.overdue ? (
                      <span className="pill pill-critical">Late by {formatWait((now.getTime() - wait.dueAt.getTime()) / 60_000)}</span>
                    ) : (
                      <span className="pill pill-info">A person answers by {when.format(wait.dueAt)}</span>
                    )
                  ) : (
                    <span className="pill pill-success">Our team replied</span>
                  )}
                </div>
                {wait?.overdue && <p className="text-sm text-critical">We&apos;re late on this one, sorry. It&apos;s at the top of our team&apos;s list.</p>}
                <ol className="flex flex-col gap-2 text-sm">
                  {messages.map((m) => (
                    <li key={m.id}>
                      <span className="hint">{WHO[m.author] ?? m.author} · {when.format(m.createdAt)}</span>
                      <p className="whitespace-pre-line">{m.body}</p>
                    </li>
                  ))}
                </ol>
                <TicketReplyForm conversationId={t.id} />
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
