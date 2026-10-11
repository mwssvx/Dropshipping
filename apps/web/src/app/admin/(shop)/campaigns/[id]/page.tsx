import Link from "next/link";
import { notFound } from "next/navigation";
import { campaignAllowance, campaignAudienceChoices, campaignAudienceSize, campaignAudienceText, campaignStats, formatMoney, getCampaign, NotFoundError, renderCampaign } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { cancelScheduledCampaignAction, deleteCampaignAction, duplicateCampaignAction } from "../../../campaign-actions";
import { PageHeader } from "../../PageHeader";
import { CampaignEditor, SendForm, TestSendForm } from "../CampaignForms";

export const metadata = { title: "Campaign" };

const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { shop, db, user } = await requireShop("marketing");
  const c = await getCampaign(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [size, options, stats, allowance, base, audienceText] = await Promise.all([
    campaignAudienceSize(db, shop.id, c),
    c.status === "draft" ? campaignAudienceChoices(db, shop.id) : null,
    campaignStats(db, c.id),
    campaignAllowance(db, shop.id),
    storeAddress(shop),
    campaignAudienceText(db, c),
  ]);
  const preview = renderCampaign(shop, c, { name: "Ada Lovelace", clickUrl: `${base}${c.buttonPath ?? "/"}`, unsubscribeUrl: `${base}/unsubscribe/…` });
  const recipients = c.status === "draft" ? size : c.recipients;
  const blocked = !shop.mailingAddress
    ? "Add your mailing address on the campaigns page first; the law requires it in marketing emails."
    : recipients === 0
      ? "Nobody in this audience has said yes to emails yet."
      : recipients > allowance.left
        ? `That's more than the ${allowance.left} emails you have left this month.`
        : null;
  const back = <Link href="/admin/campaigns" className="hint hover:text-ink">← Email campaigns</Link>;

  return (
    <main className="pb-12">
      <PageHeader title={c.subject} back={back} />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        {c.status === "draft" ? (
          <>
            <section className="card p-5" aria-label="Edit">
              <CampaignEditor
                id={c.id}
                initial={c}
                saved={(await searchParams).saved === "1"}
                {...options!}
              />
            </section>
            <Preview subject={preview.subject} text={preview.text} />
            <section className="card p-5 flex flex-col gap-5" aria-labelledby="send-heading">
              <h2 id="send-heading" className="font-semibold">Send</h2>
              <TestSendForm id={c.id} email={user.email} />
              <div className="border-t border-border pt-4">
                <p className="text-sm pb-3">To {audienceText.replace(/^./, (ch) => ch.toLowerCase())}: <strong className="num">{recipients}</strong>. Save any edits first.</p>
                <SendForm id={c.id} recipients={recipients} disabled={blocked} />
              </div>
            </section>
            <form action={deleteCampaignAction.bind(null, c.id)}><button className="hint hover:text-critical">Delete draft</button></form>
          </>
        ) : (
          <>
            <section className="card p-5 flex flex-col gap-3" aria-labelledby="results-heading">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="results-heading" className="font-semibold flex-1">
                  {c.status === "sent" ? `Sent ${when(c.sentAt!)}` : c.status === "scheduled" ? `Scheduled for ${when(c.scheduledFor!)}` : "Sending now"}
                </h2>
                {c.status === "scheduled" && (
                  <form action={cancelScheduledCampaignAction.bind(null, c.id)}><button className="btn btn-secondary">Cancel and edit</button></form>
                )}
                <form action={duplicateCampaignAction.bind(null, c.id)}><button className="btn btn-secondary">Duplicate</button></form>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div><dt className="hint">Delivered</dt><dd className="text-xl font-semibold num">{stats.sent}<span className="hint text-sm"> of {c.recipients}</span></dd></div>
                <div><dt className="hint">Clicked</dt><dd className="text-xl font-semibold num">{stats.clicks} <span className="hint text-sm">{pct(stats.clicks, stats.sent)}</span></dd></div>
                <div><dt className="hint">Orders</dt><dd className="text-xl font-semibold num">{stats.orders}</dd></div>
                <div><dt className="hint">Sales</dt><dd className="text-xl font-semibold num">{formatMoney(stats.salesMinor, shop.currency)}</dd></div>
              </dl>
              {(stats.skipped > 0 || stats.failed > 0) && (
                <p className="hint text-sm">
                  {stats.skipped > 0 && `${stats.skipped} skipped because they unsubscribed before it went out. `}
                  {stats.failed > 0 && `${stats.failed} couldn't be delivered.`}
                </p>
              )}
              <p className="hint text-sm">Orders count when the buyer clicked the link and paid within a week.</p>
            </section>
            <Preview subject={preview.subject} text={preview.text} />
          </>
        )}
      </div>
    </main>
  );
}

function Preview({ subject, text }: { subject: string; text: string }) {
  return (
    <section className="card p-5 flex flex-col gap-3" aria-labelledby="preview-heading">
      <h2 id="preview-heading" className="font-semibold">Preview</h2>
      <p className="text-sm"><span className="hint">Subject:</span> {subject}</p>
      <pre className="whitespace-pre-wrap font-sans text-sm bg-sunken rounded-md p-4">{text}</pre>
      <p className="hint text-xs">Shown with a sample buyer named Ada.</p>
    </section>
  );
}
