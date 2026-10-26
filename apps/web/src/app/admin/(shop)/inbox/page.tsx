import Link from "next/link";
import { listInbox } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { ConversationStatus } from "./ConversationStatus";

export const metadata = { title: "Inbox" };

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const { shop, db } = await requireShop("inbox");
  const all = show === "all";
  const rows = await listInbox(db, shop.id, all ? "all" : "needs_you");
  const tab = (active: boolean) => `px-3 py-1.5 rounded-md text-sm ${active ? "bg-surface border border-border font-semibold" : "text-muted hover:text-ink"}`;
  return (
    <main className="pb-12">
      <PageHeader title="Inbox" actions={<Link href="/admin/inbox/replies" className="btn btn-secondary">Saved replies</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        <p className="hint max-w-2xl">
          Buyers write from their order page or your store&apos;s contact page. Buyer support answers the kinds of question you allow in <Link className="underline" href="/admin/ai">AI settings</Link>, drafts the rest for you to check, and hands you anything about refunds, changes or complaints.
        </p>
        <nav className="flex gap-1 bg-sunken rounded-lg p-1 self-start" aria-label="Filter">
          <Link href="/admin/inbox" className={tab(!all)} aria-current={!all ? "page" : undefined}>Needs you</Link>
          <Link href="/admin/inbox?show=all" className={tab(all)} aria-current={all ? "page" : undefined}>All</Link>
        </nav>
        {rows.length === 0 ? (
          <p className="card p-6 text-sm text-muted">{all ? "No buyer has written yet." : "You're all caught up."}</p>
        ) : (
          <ul className="card divide-y divide-border">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/inbox/${c.id}`} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-5 py-3 hover:bg-sunken">
                  <span className="font-medium sm:w-40 shrink-0 truncate">{c.subject}</span>
                  <span className="text-sm text-muted truncate flex-1 min-w-0">
                    {c.last ? `${c.last.author === "buyer" ? "" : c.last.author === "merchant" ? "You: " : "Assistant: "}${c.last.body}` : ""}
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    <ConversationStatus status={c.status} drafts={c.drafts} />
                    <span className="hint num">{when.format(c.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
