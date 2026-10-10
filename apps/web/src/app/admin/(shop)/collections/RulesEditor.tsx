"use client";
import { useMemo, useState } from "react";
import { applyRules, type CollectionCondition, type CollectionRules } from "@sf/core/collection-rules";
import { formatMoney, parseMoney } from "@sf/core/money";

export type RuleProductView = {
  id: string;
  title: string;
  imageUrl: string | null;
  status: string;
  createdAt: string;
  variants: { priceMinor: number; compareAtMinor: number | null; stock: number | null; options: Record<string, string> }[];
};

type Kind = CollectionCondition["kind"];
/** A condition as typed, before it's checked: prices stay text until saved. */
export type DraftCondition = { kind: Kind; text: string; price: string; days: string; name: string; value: string };

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "title_contains", label: "Title contains" },
  { kind: "price_at_most", label: "Price is at most" },
  { kind: "price_at_least", label: "Price is at least" },
  { kind: "on_sale", label: "Is on sale (has a compare-at price)" },
  { kind: "in_stock", label: "Is in stock" },
  { kind: "added_within_days", label: "Was added in the last" },
  { kind: "option_is", label: "Has an option" },
];

const blank = (kind: Kind = "title_contains"): DraftCondition => ({ kind, text: "", price: "", days: "30", name: "", value: "" });

export function toDraft(c: CollectionCondition): DraftCondition {
  const d = blank(c.kind);
  if (c.kind === "title_contains") d.text = c.text;
  if (c.kind === "price_at_least" || c.kind === "price_at_most") d.price = (c.minor / 100).toFixed(2);
  if (c.kind === "added_within_days") d.days = String(c.days);
  if (c.kind === "option_is") Object.assign(d, { name: c.name, value: c.value });
  return d;
}

/** The draft as a rule, or null while it's incomplete (it's left out of the preview). */
function fromDraft(d: DraftCondition): CollectionCondition | null {
  switch (d.kind) {
    case "title_contains":
      return d.text.trim() ? { kind: d.kind, text: d.text } : null;
    case "price_at_least":
    case "price_at_most":
      try {
        return { kind: d.kind, minor: parseMoney(d.price) };
      } catch {
        return null;
      }
    case "added_within_days":
      return /^\d+$/.test(d.days.trim()) && Number(d.days) > 0 ? { kind: d.kind, days: Number(d.days) } : null;
    case "option_is":
      return d.name.trim() && d.value.trim() ? { kind: d.kind, name: d.name, value: d.value } : null;
    default:
      return { kind: d.kind };
  }
}

export function RulesEditor({ initial, products, currency }: { initial: CollectionRules | null; products: RuleProductView[]; currency: string }) {
  const [match, setMatch] = useState<CollectionRules["match"]>(initial?.match ?? "all");
  const [sort, setSort] = useState<CollectionRules["sort"]>(initial?.sort ?? "newest");
  const [conditions, setConditions] = useState<DraftCondition[]>(initial?.conditions.length ? initial.conditions.map(toDraft) : [blank()]);
  const set = (i: number, patch: Partial<DraftCondition>) => setConditions(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const active = useMemo(() => products.filter((p) => p.status === "active"), [products]);
  const ready = conditions.map(fromDraft).filter((c): c is CollectionCondition => !!c);
  const matching = ready.length ? applyRules(active, { match, sort, conditions: ready }) : [];

  return (
    <section className="card p-5 flex flex-col gap-4" aria-label="Rules">
      <input type="hidden" name="rules" value={JSON.stringify({ match, sort, conditions })} />
      <div>
        <h2 className="font-semibold">Rules</h2>
        <p className="hint">Products that are on sale and meet the rules show up on their own, and leave when they stop meeting them. Nothing to keep up to date by hand.</p>
      </div>
      <div className="field">
        <label className="label" htmlFor="ruleMatch">Products must meet</label>
        <select className="input" id="ruleMatch" value={match} onChange={(e) => setMatch(e.target.value as CollectionRules["match"])}>
          <option value="all">Every condition</option>
          <option value="any">Any one condition</option>
        </select>
      </div>
      <ol className="flex flex-col gap-2">
        {conditions.map((c, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 border border-border rounded-md p-2">
            <select className="input w-auto" aria-label={`Condition ${i + 1}`} value={c.kind} onChange={(e) => set(i, { kind: e.target.value as Kind })}>
              {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
            {c.kind === "title_contains" && <input className="input w-auto flex-1 min-w-32" aria-label={`Word ${i + 1}`} placeholder="mug" value={c.text} onChange={(e) => set(i, { text: e.target.value })} />}
            {(c.kind === "price_at_most" || c.kind === "price_at_least") && (
              <input className="input num w-28" inputMode="decimal" aria-label={`Price ${i + 1}`} placeholder="30.00" value={c.price} onChange={(e) => set(i, { price: e.target.value })} />
            )}
            {c.kind === "added_within_days" && (
              <>
                <input className="input num w-20" inputMode="numeric" aria-label={`Days ${i + 1}`} value={c.days} onChange={(e) => set(i, { days: e.target.value })} />
                <span className="text-sm">days</span>
              </>
            )}
            {c.kind === "option_is" && (
              <>
                <input className="input w-28" aria-label={`Option ${i + 1}`} placeholder="Color" value={c.name} onChange={(e) => set(i, { name: e.target.value })} />
                <span className="text-sm">is</span>
                <input className="input w-28" aria-label={`Value ${i + 1}`} placeholder="Red" value={c.value} onChange={(e) => set(i, { value: e.target.value })} />
              </>
            )}
            <button type="button" className="hint hover:text-critical px-1 ml-auto disabled:opacity-30" disabled={conditions.length === 1} onClick={() => setConditions(conditions.filter((_, j) => j !== i))} aria-label={`Remove condition ${i + 1}`}>✕</button>
          </li>
        ))}
      </ol>
      <div>
        <button type="button" className="btn btn-secondary" disabled={conditions.length >= 10} onClick={() => setConditions([...conditions, blank(conditions.some((c) => c.kind === "in_stock") ? "price_at_most" : "in_stock")])}>Add condition</button>
      </div>
      <div className="field">
        <label className="label" htmlFor="ruleSort">Show them</label>
        <select className="input" id="ruleSort" value={sort} onChange={(e) => setSort(e.target.value as CollectionRules["sort"])}>
          <option value="newest">Newest first</option>
          <option value="price_asc">Lowest price first</option>
          <option value="price_desc">Highest price first</option>
          <option value="title">A to Z</option>
        </select>
      </div>
      <div className="flex flex-col gap-2" aria-live="polite">
        <h3 className="text-sm font-semibold">{matching.length === 1 ? "1 product matches now" : `${matching.length} products match now`}</h3>
        {matching.length === 0 && <p className="hint">{ready.length ? "None of your products on sale meet these rules yet." : "Fill in a condition to see which products match."}</p>}
        <ul className="flex flex-col gap-1" aria-label="Matching products">
          {matching.slice(0, 12).map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              {p.imageUrl ? <img src={p.imageUrl} alt="" className="size-7 rounded object-cover" /> : <span className="size-7 rounded bg-sunken" />}
              <span className="flex-1 truncate">{p.title}</span>
              <span className="hint num">{formatMoney(Math.min(...p.variants.map((v) => v.priceMinor)), currency)}</span>
            </li>
          ))}
        </ul>
        {matching.length > 12 && <p className="hint">and {matching.length - 12} more.</p>}
      </div>
    </section>
  );
}
