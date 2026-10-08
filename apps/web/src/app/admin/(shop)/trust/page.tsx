import Link from "next/link";
import { listNotices, markNoticesRead, verifiedChecklist } from "@sf/core";
import { requireShop } from "@/lib/server";
import { checkVerifiedAction } from "../../trust-actions";
import { PageHeader } from "../PageHeader";
import { AppealForm } from "./AppealForm";

export const metadata = { title: "Trust" };

const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const KIND: Record<string, [string, string]> = {
  warning: ["Warning", "pill-warning"],
  paused: ["Store paused", "pill-critical"],
  reinstated: ["Reopened", "pill-success"],
};

export default async function TrustPage() {
  const { shop, db } = await requireShop();
  const [notices, check] = await Promise.all([listNotices(db, shop.id), verifiedChecklist(db, shop)]);
  await markNoticesRead(db, shop.id);
  const open = notices.filter((n) => !n.closedAt);
  const closed = notices.filter((n) => n.closedAt);

  return (
    <main className="pb-12">
      <PageHeader title="Trust" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <section className="card p-5 flex flex-col gap-2">
          <h2 className="font-semibold">Your store's standing</h2>
          {shop.status === "active" && !open.length ? (
            <p className="text-sm">All good. Nothing needs your attention.</p>
          ) : (
            <p className="text-sm">{shop.status === "active" ? "Your store is open, but there's something to fix below." : "Your store is paused. Buyers can browse but can't order until it's reopened."}</p>
          )}
          <p className="hint">Our promise: we warn you first, with the reason and a deadline, before we ever pause a store. The only exceptions are illegal products and failed identity checks. Every decision can be appealed to a person.</p>
        </section>

        {open.map((n) => (
          <section key={n.id} className={`card p-5 flex flex-col gap-3 ${n.kind === "paused" ? "border-critical" : ""}`} aria-labelledby={`n-${n.id}`}>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`pill ${KIND[n.kind]![1]}`}>{KIND[n.kind]![0]}</span>
              <h2 id={`n-${n.id}`} className="font-semibold">{n.title}</h2>
              {n.dueBy && <span className="pill pill-warning">Fix by {day.format(n.dueBy)}</span>}
            </div>
            <p className="text-sm"><span className="font-semibold">What happened: </span>{n.explanation}</p>
            <p className="text-sm"><span className="font-semibold">What to do: </span>{n.whatToDo}</p>
            <p className="hint">Sent {day.format(n.createdAt)}{n.createdBy === "Automatic check" ? " by our daily check" : ""}.</p>
            {n.appeals.map((a) => (
              <div key={a.id} className="border-l-2 border-border pl-3 text-sm flex flex-col gap-1">
                <p><span className="font-semibold">Your appeal: </span>{a.message}</p>
                {a.status === "open" ? <p className="hint">Waiting for a reply. A person reads every appeal and replies here, usually within two working days.</p> : <p><span className="font-semibold">{a.status === "accepted" ? "Accepted: " : "Not accepted: "}</span>{a.response}</p>}
              </div>
            ))}
            {!n.appeals.some((a) => a.status === "open") && <AppealForm noticeId={n.id} label={n.kind === "paused" ? "Appeal" : "Reply or appeal"} />}
          </section>
        ))}

        <section className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold">Verified store badge</h2>
              {shop.verifiedAt ? <span className="pill pill-success">Verified since {day.format(shop.verifiedAt)}</span> : <span className="pill pill-neutral">Not yet</span>}
            </div>
            <form action={checkVerifiedAction}><button className="btn btn-secondary">Check now</button></form>
          </div>
          <p className="text-sm hint">The badge shows in your store's footer and links to a public page listing these rules, so buyers know what it means. We check every day.</p>
          <ul className="flex flex-col gap-2 text-sm">
            {check.items.map((i) => (
              <li key={i.key} className="flex items-start justify-between gap-4">
                <span className="flex gap-2.5">
                  <span aria-hidden className={i.met ? "text-success font-bold" : "text-muted"}>{i.met ? "✓" : "○"}</span>
                  <span className={i.met ? "" : "font-medium"}>{i.label}</span>
                </span>
                <span className={`num shrink-0 ${i.met ? "hint" : ""}`}>
                  {i.key === "returns" && !i.met ? <Link className="underline" href="/admin/pages/new">Add a returns page</Link> : i.key === "identity" && !i.met ? <Link className="underline" href="/admin/money">Finish setup</Link> : i.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {closed.length > 0 && (
          <section className="card p-5 flex flex-col gap-3">
            <h2 className="font-semibold">History</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {closed.map((n) => (
                <li key={n.id} className="flex gap-3 flex-wrap items-center">
                  <span className={`pill ${KIND[n.kind]![1]}`}>{KIND[n.kind]![0]}</span>
                  <span>{n.title}</span>
                  <span className="hint">{day.format(n.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
