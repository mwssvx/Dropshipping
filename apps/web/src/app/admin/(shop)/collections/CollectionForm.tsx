"use client";
import { useActionState, useMemo, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { CollectionRules } from "@sf/core/collection-rules";
import type { FormState } from "../../actions";
import { RulesEditor, type RuleProductView } from "./RulesEditor";

/** Title, description, cover image, and either a hand-picked, ordered list of products or rules. */
export function CollectionForm({
  action,
  initial,
  products,
  submitLabel,
  saved,
  currency,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  initial: { title: string; description: string; imageUrl: string; productIds: string[]; rules: CollectionRules | null };
  products: RuleProductView[];
  currency: string;
  submitLabel: string;
  saved?: boolean;
}) {
  const [state, formAction] = useActionState(action, saved ? { saved: true } : {});
  const [picked, setPicked] = useState(initial.productIds);
  const [mode, setMode] = useState<"manual" | "auto">(initial.rules ? "auto" : "manual");
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const matches = products.filter((p) => !picked.includes(p.id) && p.title.toLowerCase().includes(query.trim().toLowerCase()));
  const move = (i: number, d: -1 | 1) => {
    const next = [...picked];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setPicked(next);
  };

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
      <div className="flex flex-col gap-6 min-w-0">
        <FormError message={state.error} />
        {state.saved && <p role="status" className="banner banner-info">Saved.</p>}
        <section className="card p-5 flex flex-col gap-4">
          <div className="field">
            <label className="label" htmlFor="title">Title</label>
            <input className="input" id="title" name="title" required maxLength={120} defaultValue={initial.title} placeholder="Best sellers" />
          </div>
          <div className="field">
            <label className="label" htmlFor="description">Description</label>
            <textarea className="input" id="description" name="description" rows={4} defaultValue={initial.description} />
          </div>
          <div className="field">
            <label className="label" htmlFor="imageUrl">Cover image address</label>
            <input className="input" id="imageUrl" name="imageUrl" type="url" defaultValue={initial.imageUrl} placeholder="https://…" />
            <span className="hint">Leave empty to use the first product's picture.</span>
          </div>
        </section>
        <fieldset className="card p-5 flex flex-col gap-2">
          <legend className="sr-only">How products are added</legend>
          <h2 className="font-semibold">How products are added</h2>
          <input type="hidden" name="mode" value={mode} />
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="modeChoice" checked={mode === "manual"} onChange={() => setMode("manual")} className="mt-1" />
            <span><span className="font-medium">I pick them</span><span className="hint block">Choose products one by one and set their order.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="modeChoice" checked={mode === "auto"} onChange={() => setMode("auto")} className="mt-1" />
            <span><span className="font-medium">By rules</span><span className="hint block">Like "price at most $30" or "added in the last 30 days". New products that match join on their own.</span></span>
          </label>
        </fieldset>
        {mode === "auto" ? (
          <RulesEditor initial={initial.rules} products={products} currency={currency} />
        ) : (
        <section className="card p-5 flex flex-col gap-4">
          <div>
            <h2 className="font-semibold">Products in this collection</h2>
            <p className="hint">Buyers see them in this order. Draft products stay hidden until you make them active.</p>
          </div>
          {picked.length === 0 && <p className="hint">None yet. Add some from the list.</p>}
          <ol className="flex flex-col gap-2">
            {picked.map((id, i) => {
              const p = byId.get(id);
              if (!p) return null;
              return (
                <li key={id} className="flex items-center gap-3 border border-border rounded-md p-2">
                  <input type="hidden" name="productIds" value={id} />
                  {p.imageUrl ? <img src={p.imageUrl} alt="" className="size-9 rounded object-cover" /> : <span className="size-9 rounded bg-sunken" />}
                  <span className="flex-1 min-w-0 truncate text-sm font-medium">{p.title}{p.status !== "active" && <span className="hint"> · {p.status}</span>}</span>
                  <button type="button" className="hint px-1 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p.title} up`}>↑</button>
                  <button type="button" className="hint px-1 disabled:opacity-30" disabled={i === picked.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${p.title} down`}>↓</button>
                  <button type="button" className="hint hover:text-critical px-1" onClick={() => setPicked(picked.filter((x) => x !== id))} aria-label={`Remove ${p.title}`}>✕</button>
                </li>
              );
            })}
          </ol>
        </section>
        )}
      </div>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
        {mode === "manual" && (
        <section className="card p-4 flex flex-col gap-3">
          <label className="label" htmlFor="find">Add products</label>
          <input id="find" className="input" placeholder="Search your products" value={query} onChange={(e) => setQuery(e.target.value)} />
          <ul className="flex flex-col max-h-80 overflow-y-auto">
            {matches.length === 0 && <li className="hint py-2">{products.length ? "No more matches." : "You have no products yet."}</li>}
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setPicked([...picked, p.id])} className="w-full flex items-center gap-2 text-left text-sm px-2 py-2 rounded-md hover:bg-sunken">
                  <span aria-hidden className="text-accent font-bold">+</span>
                  <span className="truncate">{p.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        )}
        <SubmitButton className="btn btn-primary btn-lg">{submitLabel}</SubmitButton>
      </aside>
    </form>
  );
}
