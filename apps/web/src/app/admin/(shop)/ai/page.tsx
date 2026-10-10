import { aiBudget, BUYER_TOPICS, formatMoney, listAgentActivity } from "@sf/core";
import { aiModel, requireShop } from "@/lib/server";
import { AGENT_LABEL } from "@/components/ApprovalCard";
import { PageHeader } from "../PageHeader";
import { AiSettingsForm, MarginCheckButton } from "./AiForms";

export const metadata = { title: "AI settings" };

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const STATUS: Record<string, [string, string]> = {
  done: ["Done", "pill-success"],
  approved: ["You approved", "pill-success"],
  rejected: ["You turned down", "pill-neutral"],
  failed: ["Didn't work", "pill-critical"],
  blocked: ["Not allowed", "pill-warning"],
};
const WHAT = {
  listing: "Writes product titles and descriptions when you press “Write with AI”. Drafts change straight away; products on sale wait for your OK.",
  assistant: "Answers your questions in the Assistant. Looks things up freely; settings changes and customer emails wait for your OK.",
  buyer_support: "Answers buyers' questions from their order page, or drafts a reply, or hands it to you.",
  fulfilment: "Looks at orders the supplier couldn't take: retries, or proposes a refund and an apology for you to approve.",
  margin: "Once a day, checks supplier costs. Only runs the model if a product on sale keeps less than 10%.",
  writer: "Drafts blog posts when you press “Write a draft” on the Blog page. Posts stay drafts until you publish them.",
  translator: "Translates your store when you press “Translate with AI” on the Languages page. You can edit any translation afterwards.",
  answerer: "Drafts answers to shoppers' product questions when you press “Draft with AI” on the Questions page. Nothing is sent until you send it.",
  sizer: "Drafts a size chart from a product's description when you press “Draft with AI” on the Size charts page. It stays hidden until you check it and show it.",
};

export default async function AiSettingsPage() {
  const { shop, db } = await requireShop("ai");
  const [budget, activity] = await Promise.all([aiBudget(db, shop), listAgentActivity(db, shop.id, 40)]);
  const usd = (m: number) => formatMoney(m, "USD");
  const model = aiModel();
  return (
    <main className="pb-12">
      <PageHeader title="AI settings" />
      <div className="px-4 sm:px-8 grid gap-6 lg:grid-cols-[1fr_340px] items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <section className="card p-5 flex flex-col gap-4" aria-labelledby="budget-title">
            <div className="flex justify-between items-baseline gap-3 flex-wrap">
              <h2 id="budget-title" className="font-semibold">This month</h2>
              <span className="num text-sm"><span className="font-semibold">{usd(budget.spentMinor)}</span> of {usd(budget.limitMinor)} used</span>
            </div>
            <div className="h-2.5 rounded-full bg-sunken overflow-hidden" role="progressbar" aria-label="AI budget used" aria-valuemin={0} aria-valuemax={budget.limitMinor} aria-valuenow={Math.min(budget.spentMinor, budget.limitMinor)}>
              <div className={`h-full ${budget.left ? "bg-accent" : "bg-critical"}`} style={{ width: `${budget.limitMinor ? Math.min(100, (budget.spentMinor / budget.limitMinor) * 100) : 100}%` }} />
            </div>
            <p className="hint">
              {model.live ? "Answers come from Claude." : "Demo mode: a built-in stand-in answers until an Anthropic API key is added; costs shown are what Claude would roughly cost."}{" "}
              Resets {budget.resetsOn.toLocaleDateString("en-US", { month: "long", day: "numeric" })}.
            </p>
            <AiSettingsForm
              budget={shop.aiBudgetMinor === null ? "" : (shop.aiBudgetMinor / 100).toFixed(2)}
              planMax={(budget.planMaxMinor / 100).toFixed(2)}
              topics={Object.entries(BUYER_TOPICS).map(([key, label]) => ({ key, label, on: shop.aiAutoReplyTopics.includes(key) }))}
              autoPause={shop.aiAutoPause}
            />
          </section>
          <section className="card" aria-labelledby="activity-title">
            <h2 id="activity-title" className="font-semibold px-5 pt-4 pb-2">What the assistants did</h2>
            {activity.length === 0 ? (
              <p className="px-5 pb-5 text-sm hint">Nothing yet. Every look-up and change is listed here.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>When</th><th>Who</th><th>What</th><th>Result</th></tr></thead>
                  <tbody>
                    {activity.map((a) => (
                      <tr key={a.id}>
                        <td className="hint num whitespace-nowrap">{when.format(a.createdAt)}</td>
                        <td className="whitespace-nowrap">{AGENT_LABEL[a.agent]}</td>
                        <td className="min-w-[16rem]">{a.summary}{(a.error || (a.status === "blocked" && a.reason)) && <span className="hint block">{a.error ?? a.reason}</span>}</td>
                        <td><span className={`pill ${STATUS[a.status]?.[1] ?? "pill-neutral"}`}>{STATUS[a.status]?.[0] ?? a.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        <aside className="flex flex-col gap-4">
          <h2 className="font-semibold">Your assistants</h2>
          {(Object.keys(WHAT) as (keyof typeof WHAT)[]).map((k) => {
            const used = budget.byAgent[k];
            return (
              <div key={k} className="card p-4 flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between gap-2"><span className="font-medium">{AGENT_LABEL[k]}</span><span className="hint num">{used ? `${used.runs} run${used.runs === 1 ? "" : "s"} · ${usd(Math.ceil(used.micros / 10_000))}` : "Not used yet"}</span></div>
                <p className="hint">{WHAT[k]}</p>
                {k === "margin" && <MarginCheckButton />}
              </div>
            );
          })}
        </aside>
      </div>
    </main>
  );
}
