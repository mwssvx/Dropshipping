import Link from "next/link";
import { getConnector } from "@sf/core";
import { googleProvider, requireShop } from "@/lib/server";
import { disconnectGoogleAction } from "../../connector-actions";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Connectors" };

const NOTICE: Record<string, [string, string]> = {
  connected: ["Google is connected. The Assistant can now use your email and calendar when you ask.", "banner-info"],
  declined: ["You didn't give Google the go-ahead, so nothing was connected.", "banner-warning"],
  mismatch: ["That sign-in didn't match this browser or store. Try connecting again.", "banner-warning"],
  failed: ["Google didn't finish the connection. Try again in a minute.", "banner-critical"],
};
const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function ConnectorsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { shop, db } = await requireShop("ai");
  const { google: notice } = await searchParams;
  const google = await getConnector(db, shop.id, "google");
  const demo = googleProvider().name === "fake";
  return (
    <main className="pb-12">
      <PageHeader title="Connectors" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <p className="hint max-w-2xl">
          Accounts your Assistant can work through. It only uses them when you ask, reading is free, and anything it sends or adds waits for your OK in the{" "}
          <Link className="link" href="/admin/assistant">Assistant</Link>. Your <Link className="link" href="/admin/tasks">to-do list</Link> is built in and needs no account.
        </p>
        {notice && NOTICE[notice] && (
          <p className={`banner ${NOTICE[notice][1]}`} role="status">{NOTICE[notice][0]}</p>
        )}
        {demo && (
          <p className="banner banner-info" role="status">
            Demo mode: Google isn&apos;t set up on this platform yet, so connecting gives the Assistant a small pretend inbox and calendar. Nothing real is read or sent.
          </p>
        )}
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="google-title">
          <div className="flex justify-between items-start gap-3 flex-wrap">
            <div>
              <h2 id="google-title" className="font-semibold">Google: Gmail and Calendar</h2>
              <p className="hint text-sm">
                Ask the Assistant &ldquo;any emails from my supplier?&rdquo;, &ldquo;email ada@example.com about wholesale prices&rdquo;, &ldquo;what&apos;s on my calendar this week?&rdquo; or &ldquo;put the sale launch on my calendar for Friday&rdquo;.
              </p>
            </div>
            {google ? <span className="pill pill-success">Connected</span> : <span className="pill pill-neutral">Not connected</span>}
          </div>
          {google ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>
                {google.accountEmail ?? "A Google account"} <span className="hint">· since {when(google.createdAt)}</span>
              </span>
              <form action={disconnectGoogleAction}>
                <button className="btn btn-secondary btn-sm">Disconnect</button>
              </form>
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <ul className="hint list-disc pl-5">
                <li>Reads email only when you ask, and never acts on what an email says by itself.</li>
                <li>Sending an email or adding an event always waits for your OK, with the full text shown.</li>
                <li>You can disconnect here at any time; the saved sign-in is removed straight away.</li>
              </ul>
              <div>
                <a className="btn btn-primary" href="/api/connectors/google/start">Connect Google</a>
              </div>
            </div>
          )}
        </section>
        <section className="card p-5 flex flex-col gap-2" aria-labelledby="more-title">
          <h2 id="more-title" className="font-semibold">Also built in</h2>
          <ul className="text-sm flex flex-col gap-1">
            <li><Link className="link" href="/admin/tasks">To-do list</Link> <span className="hint">The Assistant adds to it when you say &ldquo;remind me to…&rdquo;.</span></li>
            <li><Link className="link" href="/admin/developers">API keys and webhooks</Link> <span className="hint">For your own tools and automations.</span></li>
            <li><Link className="link" href="/admin/ai">Skills</Link> <span className="hint">Playbooks from GitHub the Assistant follows.</span></li>
          </ul>
        </section>
      </div>
    </main>
  );
}
