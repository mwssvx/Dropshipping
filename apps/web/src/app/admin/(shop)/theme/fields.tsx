"use client";
import { useId } from "react";
import { TRUST_ICONS, type MenuItem, type SectionSettings, type SectionType, type TrustIcon } from "@sf/core/theme";

/*
 * Form controls for the theme editor. Every control is labelled and edits one value.
 * Section forms are described as data (SECTION_FIELDS) so adding a section type is one entry.
 */

export type LinkOption = { label: string; href: string };
export type CollectionOption = { id: string; title: string };

type Field =
  | { key: string; label: string; kind: "text" | "textarea" | "image" | "link"; hint?: string; max?: number }
  | { key: string; label: string; kind: "select"; options: { value: string; label: string }[] }
  | { key: string; label: string; kind: "number"; min: number; max: number }
  | { key: string; label: string; kind: "collection" | "collections" | "faq" | "quotes" | "badges" };

export const TRUST_ICON_LABELS: Record<TrustIcon, string> = {
  shipping: "Delivery truck",
  returns: "Return arrow",
  secure: "Padlock",
  support: "Chat bubble",
  quality: "Star",
  eco: "Leaf",
};

export const SECTION_FIELDS: Record<SectionType, Field[]> = {
  announcement: [
    { key: "text", label: "Message", kind: "text", max: 160 },
    { key: "link", label: "Link (optional)", kind: "link" },
  ],
  hero: [
    { key: "heading", label: "Heading", kind: "text", max: 120 },
    { key: "text", label: "Text", kind: "textarea", max: 400 },
    { key: "buttonLabel", label: "Button label", kind: "text", max: 40, hint: "Leave empty for no button." },
    { key: "buttonLink", label: "Button link", kind: "link" },
    { key: "imageUrl", label: "Background image", kind: "image" },
    { key: "height", label: "Height", kind: "select", options: [{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }] },
    { key: "align", label: "Text position", kind: "select", options: [{ value: "center", label: "Centered" }, { value: "left", label: "Left" }] },
  ],
  featured_products: [
    { key: "heading", label: "Heading", kind: "text", max: 120 },
    { key: "collectionId", label: "Products from", kind: "collection" },
    { key: "limit", label: "How many to show", kind: "number", min: 2, max: 12 },
  ],
  collection_list: [
    { key: "heading", label: "Heading", kind: "text", max: 120 },
    { key: "collectionIds", label: "Collections", kind: "collections" },
  ],
  image_with_text: [
    { key: "heading", label: "Heading", kind: "text", max: 120 },
    { key: "text", label: "Text", kind: "textarea", max: 1000 },
    { key: "imageUrl", label: "Image", kind: "image" },
    { key: "imagePosition", label: "Image side", kind: "select", options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }] },
    { key: "buttonLabel", label: "Button label", kind: "text", max: 40, hint: "Leave empty for no button." },
    { key: "buttonLink", label: "Button link", kind: "link" },
  ],
  rich_text: [
    { key: "heading", label: "Heading", kind: "text", max: 120 },
    { key: "text", label: "Text", kind: "textarea", max: 4000, hint: "Leave a blank line between paragraphs." },
  ],
  faq: [
    { key: "heading", label: "Heading", kind: "text", max: 120 },
    { key: "items", label: "Questions", kind: "faq" },
  ],
  testimonials: [
    { key: "heading", label: "Heading", kind: "text", max: 120 },
    { key: "items", label: "Quotes", kind: "quotes" },
  ],
  trust_badges: [
    { key: "heading", label: "Heading (optional)", kind: "text", max: 120 },
    { key: "items", label: "Badges", kind: "badges" },
  ],
  newsletter: [
    { key: "heading", label: "Heading", kind: "text", max: 120 },
    { key: "text", label: "Text", kind: "textarea", max: 400 },
    { key: "buttonLabel", label: "Button label", kind: "text", max: 40, hint: "Buyers confirm by email before they're added to your list in Email campaigns." },
  ],
  reviews: [
    { key: "heading", label: "Heading", kind: "text", max: 120 },
    { key: "limit", label: "How many to show", kind: "number", min: 3, max: 12 },
    { key: "minRating", label: "Fewest stars shown", kind: "number", min: 1, max: 5 },
  ],
};

export function LinkInput({ id, value, onChange, links }: { id: string; value: string; onChange: (v: string) => void; links: LinkOption[] }) {
  const listId = `${id}-links`;
  return (
    <>
      <input id={id} className="input" value={value} list={listId} placeholder="/collections/all or https://…" onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>{links.map((l) => <option key={l.href} value={l.href}>{l.label}</option>)}</datalist>
    </>
  );
}

export function SectionForm<T extends SectionType>({
  type,
  settings,
  onChange,
  links,
  collections,
}: {
  type: T;
  settings: SectionSettings[T];
  onChange: (next: SectionSettings[T]) => void;
  links: LinkOption[];
  collections: CollectionOption[];
}) {
  const base = useId();
  const values = settings as Record<string, unknown>;
  const set = (key: string, v: unknown) => onChange({ ...values, [key]: v } as SectionSettings[T]);
  return (
    <div className="flex flex-col gap-4">
      {SECTION_FIELDS[type].map((f) => {
        const id = `${base}-${f.key}`;
        const v = values[f.key];
        return (
          <div key={f.key} className="field">
            {!["faq", "collections", "quotes", "badges"].includes(f.kind) && <label className="label" htmlFor={id}>{f.label}</label>}
            {f.kind === "text" && <input id={id} className="input" value={String(v ?? "")} maxLength={f.max} onChange={(e) => set(f.key, e.target.value)} />}
            {f.kind === "textarea" && <textarea id={id} className="input" rows={4} value={String(v ?? "")} maxLength={f.max} onChange={(e) => set(f.key, e.target.value)} />}
            {f.kind === "image" && (
              <>
                <input id={id} className="input" type="url" inputMode="url" placeholder="https://…" value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} />
                <span className="hint">Paste an https image address. Uploads come with the media library.</span>
              </>
            )}
            {f.kind === "link" && <LinkInput id={id} value={String(v ?? "")} onChange={(x) => set(f.key, x)} links={links} />}
            {f.kind === "select" && (
              <select id={id} className="input" value={String(v)} onChange={(e) => set(f.key, e.target.value)}>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {f.kind === "number" && (
              <input id={id} className="input" type="number" min={f.min} max={f.max} value={Number(v)}
                onChange={(e) => set(f.key, Math.min(f.max, Math.max(f.min, Number(e.target.value) || f.min)))} />
            )}
            {f.kind === "collection" && (
              <select id={id} className="input" value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value || null)}>
                <option value="">All products</option>
                {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            )}
            {f.kind === "collections" && (
              <fieldset className="flex flex-col gap-2">
                <legend className="label mb-1">{f.label}</legend>
                {collections.length === 0 && <span className="hint">You have no collections yet. Create one under Collections.</span>}
                {collections.length > 0 && <span className="hint">Pick none to show them all.</span>}
                {collections.map((c) => {
                  const picked = (v as string[]).includes(c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={picked}
                        onChange={() => set(f.key, picked ? (v as string[]).filter((x) => x !== c.id) : [...(v as string[]), c.id])} />
                      {c.title}
                    </label>
                  );
                })}
              </fieldset>
            )}
            {f.kind === "faq" && <FaqItems label={f.label} items={v as { question: string; answer: string }[]} onChange={(x) => set(f.key, x)} />}
            {f.kind === "quotes" && (
              <ListItems label={f.label} items={v as Record<string, string>[]} onChange={(x) => set(f.key, x)} max={12} noun="quote"
                fields={[{ key: "quote", label: "Quote", textarea: true }, { key: "name", label: "Name" }]} blank={{ quote: "", name: "" }} />
            )}
            {f.kind === "badges" && (
              <ListItems label={f.label} items={v as Record<string, string>[]} onChange={(x) => set(f.key, x)} max={6} noun="badge"
                fields={[
                  { key: "icon", label: "Icon", options: TRUST_ICONS.map((i) => ({ value: i, label: TRUST_ICON_LABELS[i] })) },
                  { key: "title", label: "Title" },
                  { key: "text", label: "Text" },
                ]} blank={{ icon: "shipping", title: "New badge", text: "" }} />
            )}
            {"hint" in f && f.hint && <span className="hint">{f.hint}</span>}
          </div>
        );
      })}
    </div>
  );
}

function FaqItems({ label, items, onChange }: { label: string; items: { question: string; answer: string }[]; onChange: (v: typeof items) => void }) {
  const base = useId();
  const update = (i: number, patch: Partial<(typeof items)[number]>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="label mb-1">{label}</legend>
      {items.map((item, i) => (
        <div key={i} className="card p-3 flex flex-col gap-2">
          <label className="sr-only" htmlFor={`${base}-q${i}`}>Question {i + 1}</label>
          <input id={`${base}-q${i}`} className="input" placeholder="Question" value={item.question} onChange={(e) => update(i, { question: e.target.value })} />
          <label className="sr-only" htmlFor={`${base}-a${i}`}>Answer {i + 1}</label>
          <textarea id={`${base}-a${i}`} className="input" rows={3} placeholder="Answer" value={item.answer} onChange={(e) => update(i, { answer: e.target.value })} />
          <button type="button" className="hint hover:text-critical self-end" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            Remove question
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary self-start" onClick={() => onChange([...items, { question: "New question", answer: "" }])}>
        Add a question
      </button>
    </fieldset>
  );
}

type ItemField = { key: string; label: string; textarea?: boolean; options?: { value: string; label: string }[] };

/** A short list of small records (quotes, badges), each edited with its own labelled fields. */
function ListItems({ label, items, onChange, fields, blank, max, noun }: {
  label: string;
  items: Record<string, string>[];
  onChange: (v: Record<string, string>[]) => void;
  fields: ItemField[];
  blank: Record<string, string>;
  max: number;
  noun: string;
}) {
  const base = useId();
  const update = (i: number, key: string, value: string) => onChange(items.map((x, j) => (j === i ? { ...x, [key]: value } : x)));
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="label mb-1">{label}</legend>
      {items.map((item, i) => (
        <div key={i} className="card p-3 flex flex-col gap-2">
          {fields.map((f) => {
            const id = `${base}-${f.key}${i}`;
            return (
              <div key={f.key} className="field">
                <label className="label" htmlFor={id}>{f.label} {i + 1}</label>
                {f.options ? (
                  <select id={id} className="input" value={item[f.key] ?? ""} onChange={(e) => update(i, f.key, e.target.value)}>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.textarea ? (
                  <textarea id={id} className="input" rows={3} value={item[f.key] ?? ""} onChange={(e) => update(i, f.key, e.target.value)} />
                ) : (
                  <input id={id} className="input" value={item[f.key] ?? ""} onChange={(e) => update(i, f.key, e.target.value)} />
                )}
              </div>
            );
          })}
          <button type="button" className="hint hover:text-critical self-end" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove {noun}</button>
        </div>
      ))}
      {items.length < max && (
        <button type="button" className="btn btn-secondary self-start" onClick={() => onChange([...items, { ...blank }])}>Add a {noun}</button>
      )}
    </fieldset>
  );
}

export function MenuEditor({ title, items, onChange, links }: { title: string; items: MenuItem[]; onChange: (v: MenuItem[]) => void; links: LinkOption[] }) {
  const base = useId();
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-semibold mb-1">{title}</legend>
      {items.length === 0 && <p className="hint">No links yet.</p>}
      {items.map((item, i) => (
        <div key={i} className="card p-3 flex flex-col gap-2">
          <div className="field">
            <label className="label" htmlFor={`${base}-l${i}`}>Label</label>
            <input id={`${base}-l${i}`} className="input" value={item.label} maxLength={40}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${base}-h${i}`}>Goes to</label>
            <LinkInput id={`${base}-h${i}`} value={item.href} links={links}
              onChange={(href) => onChange(items.map((x, j) => (j === i ? { ...x, href } : x)))} />
          </div>
          <div className="flex gap-3 justify-end hint">
            <button type="button" disabled={i === 0} className="hover:text-ink disabled:opacity-40" onClick={() => move(i, -1)} aria-label={`Move ${item.label} up`}>Up</button>
            <button type="button" disabled={i === items.length - 1} className="hover:text-ink disabled:opacity-40" onClick={() => move(i, 1)} aria-label={`Move ${item.label} down`}>Down</button>
            <button type="button" className="hover:text-critical" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
          </div>
        </div>
      ))}
      <AddLink onAdd={(l) => onChange([...items, l])} links={links} />
    </fieldset>
  );
}

function AddLink({ onAdd, links }: { onAdd: (l: MenuItem) => void; links: LinkOption[] }) {
  const id = useId();
  return (
    <div className="flex gap-2">
      <label className="sr-only" htmlFor={id}>Add a link</label>
      <select id={id} className="input" value="" onChange={(e) => {
        const l = links.find((x) => x.href === e.target.value);
        onAdd(l ? { label: l.label, href: l.href } : { label: "New link", href: "/" });
      }}>
        <option value="" disabled>Add a link…</option>
        {links.map((l) => <option key={l.href} value={l.href}>{l.label}</option>)}
        <option value="__custom">Custom link</option>
      </select>
    </div>
  );
}
