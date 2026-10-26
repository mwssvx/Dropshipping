import { useState } from "react";
import { useApi } from "../../src/api";
import { when } from "../../src/format";
import { BackLink, EmptyState, List, LoadError, Loading, Pill, Row, Screen, Segmented } from "../../src/ui";

type Conversation = {
  id: string;
  subject: string;
  status: "open" | "needs_merchant" | "escalated" | "resolved";
  drafts: number;
  last: { author: "buyer" | "merchant" | "agent" | "staff"; body: string } | null;
  updatedAt: string;
};

const WHO = { buyer: "", merchant: "You: ", agent: "Buyer support: ", staff: "Our trust team: " } as const;

function status(c: Conversation) {
  if (c.drafts) return <Pill label="Draft to check" tone="warning" />;
  if (c.status === "needs_merchant") return <Pill label="Needs you" tone="warning" />;
  if (c.status === "escalated") return <Pill label="With our team" tone="info" />;
  if (c.status === "open") return <Pill label="New" tone="info" />;
  return <Pill label="Answered" />;
}

/** Buyer questions: from order pages and the store's contact page. */
export default function InboxScreen() {
  const [show, setShow] = useState<"needs_you" | "all">("needs_you");
  const inbox = useApi<{ conversations: Conversation[] }>(`inbox?show=${show}`);
  const rows = inbox.data?.conversations;
  return (
    <Screen title="Inbox" back={<BackLink href="/" label="Today" />} onRefresh={inbox.reload} refreshing={inbox.loading && !!rows}>
      <Segmented label="Show" value={show} onChange={setShow} options={[["needs_you", "Needs you"], ["all", "All"]]} />
      <LoadError error={inbox.error} stale={inbox.stale} retry={inbox.reload} />
      {!rows ? (
        inbox.loading ? <Loading /> : null
      ) : rows.length === 0 ? (
        <EmptyState heading={show === "all" ? "No messages yet" : "All caught up"} body="Buyers write from their order page or your store's contact page. Questions buyer support can't answer wait here." />
      ) : (
        <List>
          {rows.map((c) => (
            <Row
              key={c.id}
              title={c.subject}
              subtitle={`${c.last ? WHO[c.last.author] + c.last.body : ""}\n${when(c.updatedAt)}`}
              right={status(c)}
              href={`/inbox/${c.id}` as never}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
