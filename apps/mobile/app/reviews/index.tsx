import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../../src/api";
import { when } from "../../src/format";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, LoadError, Loading, Pill, Screen, Segmented } from "../../src/ui";
import { space } from "../../src/theme";

type Review = { id: string; name: string; rating: number; body: string; status: "pending" | "published" | "hidden"; reply: string | null; photos: number; productTitle: string; createdAt: string };
type Show = "pending" | "no_reply" | "all";

const EMPTY: Record<Show, [string, string]> = {
  pending: ["Nothing to check", "Reviews wait here for your OK when you check them before they go live."],
  no_reply: ["Every review has a reply", "Published reviews you haven't answered show up here. A short thank-you shows shoppers someone reads them."],
  all: ["No reviews yet", "Buyers are asked for a review after their order arrives."],
};

const STATUS = { pending: ["Waiting for you", "warning"], published: ["Live", "success"], hidden: ["Hidden", "neutral"] } as const;
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

/** Buyer reviews: publish or hide the ones waiting, and reply from the phone. */
export default function ReviewsScreen() {
  const [show, setShow] = useState<Show>("pending");
  const list = useApi<{ counts: { pending: number; noReply: number }; reviews: Review[] }>(`reviews?show=${show}`);
  const rows = list.data?.reviews;
  const counts = list.data?.counts;
  return (
    <Screen title="Reviews" back={<BackLink href="/" label="Today" />} onRefresh={list.reload} refreshing={list.loading && !!rows}>
      <Segmented
        label="Which reviews"
        value={show}
        onChange={setShow}
        options={[
          ["pending", counts?.pending ? `To check (${counts.pending})` : "To check"],
          ["no_reply", counts?.noReply ? `No reply (${counts.noReply})` : "No reply"],
          ["all", "All"],
        ]}
      />
      <LoadError error={list.error} stale={list.stale} retry={list.reload} />
      {!rows ? (
        list.loading ? <Loading /> : null
      ) : rows.length === 0 ? (
        <EmptyState heading={EMPTY[show][0]} body={EMPTY[show][1]} />
      ) : (
        rows.map((r) => <ReviewCard key={r.id} review={r} onChange={list.reload} />)
      )}
    </Screen>
  );
}

function ReviewCard({ review: r, onChange }: { review: Review; onChange: () => Promise<unknown> }) {
  const [reply, setReply] = useState(r.reply ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  async function run(key: string, change: { status?: "published" | "hidden"; reply?: string }) {
    setBusy(key);
    setNote(null);
    try {
      const res = await api<{ message: string }>(`reviews/${r.id}`, { body: change });
      setNote({ tone: "success", text: res.message });
      await onChange();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  const [label, tone] = STATUS[r.status];
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
        <Heading>{r.productTitle}</Heading>
        <Pill label={label} tone={tone} />
      </View>
      <Body>{`${stars(r.rating)}  ${r.rating} out of 5`}</Body>
      <Body>{r.body}</Body>
      <Body muted>{`${r.name} · ${when(r.createdAt)}${r.photos ? ` · ${r.photos} ${r.photos === 1 ? "photo" : "photos"}` : ""}`}</Body>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      {r.status !== "published" ? (
        <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
          <Button label="Publish" a11y={`Publish ${r.name}'s review`} busy={busy === "publish"} onPress={() => run("publish", { status: "published" })} />
          {r.status === "pending" ? <Button label="Hide" kind="secondary" a11y={`Hide ${r.name}'s review`} busy={busy === "hide"} onPress={() => run("hide", { status: "hidden" })} /> : null}
        </View>
      ) : null}
      <Field label={`Reply to ${r.name}`} value={reply} onChangeText={setReply} multiline placeholder="Thanks for the review…" hint="Shows under the review on your store. The buyer gets an email the first time." />
      {reply.trim() !== (r.reply ?? "") ? <Button label="Post reply" a11y={`Post reply to ${r.name}`} busy={busy === "reply"} onPress={() => run("reply", { reply })} /> : null}
    </Card>
  );
}
