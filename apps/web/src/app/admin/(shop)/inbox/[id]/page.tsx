import Link from "next/link";
import { notFound } from "next/navigation";
import { getConversation, listPendingActions, listRecentDecisions, NotFoundError } from "@sf/core";
import { requireShop } from "@/lib/server";
import { ApprovalCard, DecidedCard } from "@/components/ApprovalCard";
import { PageHeader } from "../../PageHeader";
import { ConversationStatus } from "../ConversationStatus";
import { ReplyForm } from "./ReplyForm";

export const metadata = { title: "Conversation" };

const time = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const WHO = { buyer: "Buyer", merchant: "You", agent: "Buyer support", staff: "Our trust team" } as const;

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { shop, db } = await requireShop("inbox");
  const { conversation, messages, order } = await getConversation(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const mine = (a: { input: Record<string, unknown> }) => messages.some((m) => m.id === a.input.message_id);
  const [pending, decided] = await Promise.all([
    listPendingActions(db, shop.id).then((r) => r.filter(mine)),
    listRecentDecisions(db, shop.id).then((r) => r.filter(mine)),
  ]);
  const shown = messages.filter((m) => m.status === "sent");
  const drafts = messages.filter((m) => m.status === "draft").length;
  return (
    <main className="pb-12">
      <PageHeader title={conversation.subject} back={<Link href="/admin/inbox" className="hint hover:text-ink">← Inbox</Link>}
        actions={<div className="flex gap-2 items-center"><ConversationStatus status={conversation.status} drafts={drafts} />{order && <Link className="btn btn-secondary" href={`/admin/orders/${order.id}`}>View order</Link>}</div>} />
      <div className="px-4 sm:px-8 grid gap-6 lg:grid-cols-[1fr_380px] items-start">
        <section className="card p-4 sm:p-5 flex flex-col gap-4 min-w-0" aria-label="Messages">
          {conversation.statusReason && conversation.status !== "resolved" && (
            <p className={`banner ${conversation.status === "escalated" ? "banner-critical" : "banner-warning"}`}>
              {conversation.status === "escalated" ? "Sent to our trust team: " : "Handed to you: "}{conversation.statusReason}
            </p>
          )}
          <ol className="flex flex-col gap-3">
            {shown.map((m) => (
              <li key={m.id} className={`flex flex-col gap-1 max-w-[85%] ${m.author === "buyer" ? "self-start" : "self-end items-end"}`}>
                <span className="hint">{WHO[m.author]} · {time.format(m.createdAt)}</span>
                <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-line ${m.author === "buyer" ? "bg-sunken" : m.author === "staff" ? "bg-info-soft" : "bg-accent-soft"}`}>{m.body}</div>
              </li>
            ))}
          </ol>
          <div className="border-t border-border pt-4">
            <ReplyForm conversationId={conversation.id} primary={pending.length === 0} />
          </div>
        </section>
        <aside className="flex flex-col gap-4">
          {decided.map((d) => <DecidedCard key={d.id} action={d} />)}
          {pending.length > 0 ? (
            <>
              <h2 className="font-semibold">Drafted reply</h2>
              {pending.map((a) => <ApprovalCard key={a.id} action={a} />)}
            </>
          ) : (
            order && (
              <div className="card p-4 text-sm flex flex-col gap-1">
                <h2 className="font-semibold">Order #{order.number}</h2>
                <p className="hint break-all">{order.email}</p>
                <p className="hint">{order.shippingAddress.name}, {order.shippingAddress.city}</p>
              </div>
            )
          )}
        </aside>
      </div>
    </main>
  );
}
