"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { addSkillAction, marginCheckAction, removeSkillAction, saveAiSettingsAction } from "../../ai-actions";

export function AiSettingsForm(props: { budget: string; planMax: string; topics: { key: string; label: string; on: boolean }[]; autoPause: boolean; shopper: boolean; weeklyReview: boolean; dailyWatch: boolean; watchEmail: boolean; monthlyEmail: boolean; skills: { key: string; title: string; when: string; on: boolean }[]; brand: { voice: string; banned: string; language: string; titleMax: string }; languages: { code: string; name: string }[]; memory: string; memoryMax: number; examples: string[] }) {
  const [state, action] = useActionState(saveAiSettingsAction, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-info" role="status">Saved.</p>}
      <div className="field max-w-xs">
        <label className="label" htmlFor="budget">Monthly AI budget (US$)</label>
        <input className="input num" id="budget" name="budget" inputMode="decimal" defaultValue={props.budget} placeholder={props.planMax} />
        <span className="hint">Up to ${props.planMax} is included in your plan. The assistants stop for the month when it&apos;s used.</span>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1">Buyer questions the assistant may answer without you checking first</legend>
        <div className="flex flex-wrap gap-2">
          {props.topics.map((t) => (
            <label key={t.key} className="chip">
              <input type="checkbox" name="topics" value={t.key} defaultChecked={t.on} /> {t.label}
            </label>
          ))}
        </div>
        <span className="hint">Replies that mention refunds, discounts or anything free always wait for you, and so do refunds, cancellations and complaints.</span>
      </fieldset>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="autoPause" defaultChecked={props.autoPause} className="mt-1 size-4" />
        <span>
          <span className="font-medium">Let margin watch take money-losing products off sale on its own</span>
          <span className="hint block">Price changes over 10% always wait for you.</span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="shopper" defaultChecked={props.shopper} className="mt-1 size-4" />
        <span>
          <span className="font-medium">Show the shopping assistant on your store</span>
          <span className="hint block">Shoppers can ask it about your products, sizes, delivery and returns. It only reads what your store already shows, can&apos;t see orders or change anything, and uses at most half of your monthly AI budget.</span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="weeklyReview" defaultChecked={props.weeklyReview} className="mt-1 size-4" />
        <span>
          <span className="font-medium">Review my store every Monday</span>
          <span className="hint block">The business analyst reads last month&apos;s numbers and leaves a few suggestions on the Insights page. Each review uses a few cents of your AI budget.</span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="dailyWatch" defaultChecked={props.dailyWatch} className="mt-1 size-4" />
        <span>
          <span className="font-medium">Watch my store every day</span>
          <span className="hint block">Each morning, yesterday&apos;s sales, visitors, checkout, refunds, stock and supplier orders are compared with your last four weeks. When something is out of line, the AI looks for the likely cause and tells you on Today and on the Insights page. Normal days cost nothing.</span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm sm:ml-7">
        <input type="checkbox" name="watchEmail" defaultChecked={props.watchEmail} className="mt-1 size-4" />
        <span>
          <span className="font-medium">Email me the store watch&apos;s alerts</span>
          <span className="hint block">Sent to everyone on the team who can see money, at most once a day.</span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="monthlyEmail" defaultChecked={props.monthlyEmail} className="mt-1 size-4" />
        <span>
          <span className="font-medium">Email me a monthly report of what the AI did</span>
          <span className="hint block">On the 1st: buyer questions answered, replies drafted, changes made, the time that roughly saved, and what it cost. Free, and skipped in months it did nothing.</span>
        </span>
      </label>
      <fieldset className="flex flex-col gap-3">
        <legend className="label mb-1">Writing rules</legend>
        <span className="hint">Every helper that writes for your store follows these, and each draft is checked against them before it&apos;s saved. Drafts that add numbers, codes or specs that aren&apos;t in the product data are refused too.</span>
        <div className="field">
          <label className="label" htmlFor="brandVoice">How your store sounds</label>
          <textarea className="input" id="brandVoice" name="brandVoice" rows={2} maxLength={400} defaultValue={props.brand.voice} placeholder="Warm and playful, short sentences, never pushy" />
        </div>
        <div className="field">
          <label className="label" htmlFor="brandBanned">Words never to use</label>
          <input className="input" id="brandBanned" name="brandBanned" defaultValue={props.brand.banned} placeholder="cheap, best ever, guaranteed" />
          <span className="hint">Separate them with commas.</span>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="field">
            <label className="label" htmlFor="brandLanguage">Write for buyers in</label>
            <select className="input" id="brandLanguage" name="brandLanguage" defaultValue={props.brand.language}>
              <option value="">English</option>
              {props.languages.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="field max-w-40">
            <label className="label" htmlFor="brandTitleMax">Longest product title</label>
            <input className="input num" id="brandTitleMax" name="brandTitleMax" inputMode="numeric" defaultValue={props.brand.titleMax} placeholder="70" />
          </div>
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label className="label" htmlFor="memory">What the Assistant remembers</label>
        <span className="hint" id="memory-hint">Tell the Assistant &ldquo;remember that…&rdquo; in the chat, or write notes here, one per line (up to {props.memoryMax}). It reads them in every chat. Buyers&apos; helpers never see them.</span>
        <textarea className="input min-h-24" id="memory" name="memory" aria-describedby="memory-hint" defaultValue={props.memory} placeholder={"We only ship from the US warehouse\nWhen I ask how I'm doing, lead with profit"} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="label">How you write to buyers</span>
        {props.examples.length ? (
          <>
            <span className="hint">When you rewrite a reply the buyer helper drafted, it keeps your version (the last {props.examples.length}) and writes more like you. It never takes facts from them.</span>
            <details className="text-sm">
              <summary className="cursor-pointer">Your replies it learned from</summary>
              <ul className="flex flex-col gap-2 mt-2">
                {props.examples.map((e, i) => (
                  <li key={i} className="card p-3 whitespace-pre-line">{e}</li>
                ))}
              </ul>
            </details>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="forgetExamples" className="size-4" />
              Forget these and start again
            </label>
          </>
        ) : (
          <span className="hint">When you rewrite a reply the buyer helper drafted, it keeps your version and writes more like you next time.</span>
        )}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1">Skills the Assistant uses</legend>
        <div className="flex flex-col gap-2">
          {props.skills.map((s) => (
            <label key={s.key} className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="skills" value={s.key} defaultChecked={s.on} className="mt-1 size-4" />
              <span>
                <span className="font-medium">{s.title}</span>
                <span className="hint block">For {s.when}.</span>
              </span>
            </label>
          ))}
        </div>
        <span className="hint">Each skill is a playbook the Assistant reads only when a question needs it, so having them on costs next to nothing.</span>
      </fieldset>
      <div><SubmitButton>Save</SubmitButton></div>
    </form>
  );
}

export function MarginCheckButton() {
  const [state, action] = useActionState(marginCheckAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      {state.message && <p className="banner banner-info whitespace-pre-line" role="status">{state.message}</p>}
      <div><SubmitButton className="btn btn-secondary" pendingText="Checking…">Check margins now</SubmitButton></div>
    </form>
  );
}

export function SkillLibrary(props: { skills: { name: string; title: string; when: string; sourceUrl: string | null }[]; max: number; sources: { title: string; url: string; note: string }[] }) {
  const [state, action] = useActionState(addSkillAction, {});
  return (
    <div className="flex flex-col gap-4">
      {props.skills.length === 0 ? (
        <p className="hint text-sm">None yet. Add one below, and the Assistant will read it whenever a question is about that area.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {props.skills.map((s) => (
            <li key={s.name} className="py-2 flex gap-3 justify-between items-start">
              <span className="min-w-0">
                <span className="font-medium">{s.title}</span>
                <span className="hint block">For {s.when.charAt(0).toLowerCase()}{s.when.slice(1).replace(/\.$/, "")}.</span>
                {s.sourceUrl && <a className="link text-xs" href={s.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a>}
              </span>
              <RemoveSkill name={s.name} title={s.title} />
            </li>
          ))}
        </ul>
      )}
      <form action={action} className="flex flex-col gap-3" aria-label="Add a skill">
        <FormError message={state.error} />
        {state.message && <p className="banner banner-info" role="status">{state.message}</p>}
        <div className="field">
          <label className="label" htmlFor="skill-link">GitHub link to a skill</label>
          <input className="input" id="skill-link" name="link" inputMode="url" placeholder="https://github.com/anthropics/skills/tree/main/skills/…" aria-describedby="skill-link-hint" />
          <span className="hint" id="skill-link-hint">
            Link to the skill&apos;s folder (the one with a SKILL.md) or to the file itself. Check the repository&apos;s licence before using its skills for your business.
          </span>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer">Or paste a skill</summary>
          <div className="field mt-2">
            <label className="label" htmlFor="skill-text">Skill text</label>
            <textarea className="input min-h-32 font-mono text-xs" id="skill-text" name="text" placeholder={"---\nname: email-sequence\ndescription: Writing a welcome email series\n---\n# Email sequences\n\nThe playbook…"} />
          </div>
        </details>
        <div className="flex flex-wrap gap-3 items-center">
          <SubmitButton pendingText="Adding…">Add skill</SubmitButton>
          <span className="hint">{props.skills.length} of {props.max}.</span>
        </div>
      </form>
      <div className="text-sm">
        <span className="hint block mb-1">Places to find skills:</span>
        <ul className="flex flex-col gap-1">
          {props.sources.map((s) => (
            <li key={s.url}>
              <a className="link" href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a> <span className="hint">{s.note}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RemoveSkill({ name, title }: { name: string; title: string }) {
  const [state, action] = useActionState(removeSkillAction.bind(null, name), {});
  return (
    <form action={action} className="shrink-0">
      <FormError message={state.error} />
      <button type="submit" className="btn btn-secondary btn-sm" aria-label={`Remove ${title}`}>Remove</button>
    </form>
  );
}
