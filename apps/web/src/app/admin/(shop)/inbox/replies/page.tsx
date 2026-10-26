import Link from "next/link";
import { listSavedReplies, MAX_SAVED_REPLIES, REPLY_FIELDS, STARTER_REPLIES } from "@sf/core";
import { requireShop } from "@/lib/server";
import { addStarterRepliesAction, deleteSavedReplyAction } from "../../../saved-reply-actions";
import { PageHeader } from "../../PageHeader";
import { SavedReplyForm } from "./SavedReplyForm";

export const metadata = { title: "Saved replies" };

export default async function SavedRepliesPage() {
  const { shop, db } = await requireShop("inbox");
  const replies = await listSavedReplies(db, shop.id);
  return (
    <main className="pb-12">
      <PageHeader title="Saved replies" back={<Link href="/admin/inbox" className="hint hover:text-ink">← Inbox</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-3xl">
        <p className="hint">
          Answers you give often, ready to drop into a reply from any conversation. You can still change the words before sending. These fill themselves in:
        </p>
        <ul className="text-sm grid gap-1 sm:grid-cols-2" aria-label="Fields">
          {Object.entries(REPLY_FIELDS).map(([field, means]) => (
            <li key={field}><code className="font-mono text-xs bg-sunken rounded px-1 py-0.5">{field}</code> <span className="hint">{means}</span></li>
          ))}
        </ul>
        <p className="hint">If a conversation has nothing to fill a field with, like tracking for an order that hasn&apos;t shipped, the field stays in braces and the reply won&apos;t send until you replace it.</p>
        {replies.length === 0 && (
          <section className="card p-5 flex flex-col gap-3 items-start" aria-label="Starter replies">
            <p className="text-sm">Start with {STARTER_REPLIES.length} replies most stores need ({STARTER_REPLIES.map((r) => r.title.toLowerCase()).join(", ")}) and change them to fit yours.</p>
            <form action={addStarterRepliesAction}>
              <button className="btn btn-secondary">Add starter replies</button>
            </form>
          </section>
        )}
        {replies.map((r) => (
          <section key={r.id} className="card p-5 flex flex-col gap-3" aria-label={r.title}>
            <SavedReplyForm reply={r} />
            <form action={deleteSavedReplyAction.bind(null, r.id)} className="border-t border-border pt-3">
              <button className="btn btn-secondary btn-sm" aria-label={`Delete “${r.title}”`}>Delete</button>
            </form>
          </section>
        ))}
        {replies.length < MAX_SAVED_REPLIES ? (
          <section className="card p-5 flex flex-col gap-3" aria-label="Add a saved reply">
            <h2 className="font-semibold">Add a reply</h2>
            <SavedReplyForm />
          </section>
        ) : (
          <p className="hint">You have {MAX_SAVED_REPLIES} saved replies, the most a store can keep. Delete one to add another.</p>
        )}
      </div>
    </main>
  );
}
