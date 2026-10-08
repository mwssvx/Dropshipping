import Link from "next/link";
import { aiBudget, assistantMessages, formatMoney, listPendingActions, listRecentDecisions } from "@sf/core";
import { aiModel, requireShop } from "@/lib/server";
import { ApprovalCard, DecidedCard } from "@/components/ApprovalCard";
import { PageHeader } from "../PageHeader";
import { AskForm } from "./AskForm";

export const metadata = { title: "Assistant" };

const time = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function AssistantPage() {
  const { shop, db } = await requireShop();
  const [messages, pending, budget, decided] = await Promise.all([
    assistantMessages(db, shop.id, 40),
    listPendingActions(db, shop.id),
    aiBudget(db, shop),
    listRecentDecisions(db, shop.id),
  ]);
  const live = aiModel().live;
  // Replies to buyers are handled in the inbox, next to the conversation.
  const here = pending.filter((p) => !("message_id" in p.input));
  const drafts = pending.length - here.length;
  return (
    <main className="pb-12">
      <PageHeader title="Assistant" actions={<Link href="/admin/ai" className="btn btn-secondary">AI settings</Link>} />
      <div className="px-4 sm:px-8 grid gap-6 lg:grid-cols-[1fr_360px] items-start">
        <section className="card flex flex-col min-w-0" aria-label="Chat with your assistant">
          {!live && (
            <p className="banner banner-info rounded-b-none">
              Demo mode: a built-in stand-in answers until an Anthropic API key is added. It looks up the same data and follows the same approval rules.
            </p>
          )}
          <ol className="flex flex-col gap-3 p-4 sm:p-5" aria-live="polite">
            {messages.length === 0 && (
              <li className="text-sm text-muted">
                Ask me anything about your store: sales, orders, products and margins. I can look things up straight away. Anything that changes your store or emails a customer waits for your OK on the right.
              </li>
            )}
            {messages.map((m) => (
              <li key={m.id} className={`flex flex-col gap-1 max-w-[85%] ${m.author === "merchant" ? "self-end items-end" : "self-start"}`}>
                <span className="hint">{m.author === "merchant" ? "You" : m.author === "staff" ? "Support team" : "Assistant"} · {time.format(m.createdAt)}</span>
                <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-line ${m.author === "merchant" ? "bg-accent text-accent-ink" : m.author === "staff" ? "bg-info-soft" : "bg-sunken"}`}>
                  {m.body}
                </div>
              </li>
            ))}
          </ol>
          <div className="border-t border-border p-4 sm:p-5">
            <AskForm />
          </div>
        </section>
        <aside className="flex flex-col gap-4" aria-labelledby="pending-title">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="pending-title" className="font-semibold">Waiting for your OK</h2>
            {here.length > 0 && <span className="pill pill-warning">{here.length}</span>}
          </div>
          {here.length === 0 && decided.length === 0 && <p className="hint">Nothing right now. When an assistant wants to change something, it shows up here first.</p>}
          {here.map((a) => <ApprovalCard key={a.id} action={a} compact />)}
          {decided.filter((d) => !("message_id" in d.input)).map((d) => <DecidedCard key={d.id} action={d} />)}
          {drafts > 0 && (
            <Link href="/admin/inbox" className="banner banner-info">
              {drafts} drafted {drafts === 1 ? "reply is" : "replies are"} waiting in the inbox →
            </Link>
          )}
          <div className="card p-4 flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="font-medium">AI this month</span>
              <span className="num">{formatMoney(budget.spentMinor, "USD")} of {formatMoney(budget.limitMinor, "USD")}</span>
            </div>
            <div className="h-2 rounded-full bg-sunken overflow-hidden" role="progressbar" aria-label="AI budget used"
              aria-valuemin={0} aria-valuemax={budget.limitMinor} aria-valuenow={Math.min(budget.spentMinor, budget.limitMinor)}>
              <div className={`h-full ${budget.left ? "bg-accent" : "bg-critical"}`} style={{ width: `${budget.limitMinor ? Math.min(100, (budget.spentMinor / budget.limitMinor) * 100) : 100}%` }} />
            </div>
            <span className="hint">{budget.left ? `Resets ${budget.resetsOn.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.` : "Used up. The assistants pause until it resets or you raise it."}</span>
          </div>
        </aside>
      </div>
    </main>
  );
}
