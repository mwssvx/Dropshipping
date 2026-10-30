"use client";
import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import {
  applyThemePreset,
  contrastRatio,
  currentPreset,
  newSectionId,
  SECTION_LABELS,
  SECTION_TYPES,
  sectionDefaults,
  THEME_FONTS,
  THEME_PRESET_IDS,
  THEME_PRESETS,
  type ThemePresetId,
  type Section,
  type SectionType,
  type ThemeDoc,
  type ThemeFont,
} from "@sf/core/theme";
import { discardThemeAction, publishThemeAction, saveThemeAction } from "../../store-actions";
import { SchedulePanel, type ThemeScheduleView } from "./SchedulePanel";
import { MenuEditor, SectionForm, type CollectionOption, type LinkOption, type ProductOption } from "./fields";

type Tab = "themes" | "sections" | "style" | "menus" | "seo";
type Save = { state: "saved" | "saving" | "unsaved" | "error"; message?: string };

/** What the preview frame listens for (see /admin/preview). */
export type PreviewMessage = { type: "sf-theme"; doc: ThemeDoc; highlight: string | null };

const PREVIEW_WIDTH = { desktop: "100%", mobile: "390px" } as const;

type History = { doc: ThemeDoc; past: ThemeDoc[]; future: ThemeDoc[]; lastEdit: number };
type HistoryAction = { type: "edit"; doc: ThemeDoc; at: number } | { type: "undo" } | { type: "redo" } | { type: "reset"; doc: ThemeDoc };

/** Undo history. Edits less than 0.7s apart (typing) share one undo step. */
function historyReducer(h: History, a: HistoryAction): History {
  switch (a.type) {
    case "edit":
      if (a.at - h.lastEdit < 700) return { ...h, doc: a.doc, future: [], lastEdit: a.at };
      return { doc: a.doc, past: [...h.past.slice(-99), h.doc], future: [], lastEdit: a.at };
    case "undo":
      if (!h.past.length) return h;
      return { doc: h.past.at(-1)!, past: h.past.slice(0, -1), future: [h.doc, ...h.future], lastEdit: 0 };
    case "redo":
      if (!h.future.length) return h;
      return { doc: h.future[0]!, past: [...h.past, h.doc], future: h.future.slice(1), lastEdit: 0 };
    case "reset":
      return { doc: a.doc, past: [], future: [], lastEdit: 0 };
  }
}

function sectionTitle(s: Section) {
  const settings = s.settings as { heading?: string; text?: string };
  return settings.heading || settings.text || SECTION_LABELS[s.type].name;
}

export function ThemeEditor({
  initial,
  hasChanges: initialChanges,
  publishedAt,
  links,
  collections,
  products,
  schedule: initialSchedule,
  revertAt: initialRevert,
  storeLink,
  shopName,
}: {
  initial: ThemeDoc;
  hasChanges: boolean;
  publishedAt: string | null;
  links: LinkOption[];
  collections: CollectionOption[];
  products: ProductOption[];
  schedule: ThemeScheduleView;
  revertAt: string | null;
  storeLink: string;
  shopName: string;
}) {
  const [history, dispatch] = useReducer(historyReducer, { doc: initial, past: [], future: [], lastEdit: 0 });
  const { doc } = history;
  const [tab, setTab] = useState<Tab>("sections");
  const [selected, setSelected] = useState<string | null>(null);
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [save, setSave] = useState<Save>({ state: "saved" });
  const [unpublished, setUnpublished] = useState(initialChanges);
  const [published, setPublished] = useState(publishedAt);
  const [publishing, setPublishing] = useState(false);
  const [later, setLater] = useState(false);
  const [schedule, setSchedule] = useState(initialSchedule);
  const [revertAt, setRevertAt] = useState(initialRevert);
  const frame = useRef<HTMLIFrameElement>(null);
  const lastSaved = useRef(JSON.stringify(initial));

  const change = useCallback((next: ThemeDoc) => dispatch({ type: "edit", doc: next, at: Date.now() }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Keep the preview in step with every edit.
  const post = useCallback(() => {
    const msg: PreviewMessage = { type: "sf-theme", doc, highlight: tab === "sections" ? selected : null };
    frame.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, [doc, selected, tab]);
  useEffect(post, [post]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === "sf-preview-ready") post();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [post]);

  // Save the draft shortly after the last edit.
  useEffect(() => {
    const json = JSON.stringify(doc);
    if (json === lastSaved.current) return;
    setSave({ state: "unsaved" });
    const t = setTimeout(async () => {
      setSave({ state: "saving" });
      const r = await saveThemeAction(doc);
      if ("error" in r) return setSave({ state: "error", message: r.error });
      lastSaved.current = json;
      setSave({ state: "saved" });
      setUnpublished(r.hasChanges);
    }, 800);
    return () => clearTimeout(t);
  }, [doc]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save.state === "unsaved" || save.state === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.state]);

  async function publish() {
    setPublishing(true);
    const r = await publishThemeAction(doc);
    setPublishing(false);
    if ("error" in r) return setSave({ state: "error", message: r.error });
    lastSaved.current = JSON.stringify(doc);
    setSave({ state: "saved" });
    setUnpublished(false);
    setPublished(r.publishedAt);
  }

  async function discard() {
    if (!confirm("Throw away your unpublished changes and go back to the live version?")) return;
    const r = await discardThemeAction();
    lastSaved.current = JSON.stringify(r.doc);
    dispatch({ type: "reset", doc: r.doc });
    setUnpublished(false);
    setSave({ state: "saved" });
  }

  const setSections = (home: Section[]) => change({ ...doc, home });
  const updateSection = (id: string, patch: Partial<Section>) =>
    setSections(doc.home.map((s) => (s.id === id ? ({ ...s, ...patch } as Section) : s)));
  const moveSection = (i: number, d: -1 | 1) => {
    const home = [...doc.home];
    [home[i], home[i + d]] = [home[i + d]!, home[i]!];
    setSections(home);
  };
  const addSection = (type: SectionType) => {
    const s = { id: newSectionId(), type, hidden: false, settings: sectionDefaults(type) } as Section;
    setSections([...doc.home, s]);
    setSelected(s.id);
  };

  const current = doc.home.find((s) => s.id === selected);
  const statusText = {
    saved: unpublished ? "Draft saved. Not live yet." : "Everything is live.",
    saving: "Saving draft…",
    unsaved: "Saving draft…",
    error: save.message ?? "Couldn't save.",
  }[save.state];

  return (
    <div className="flex flex-col h-[calc(100dvh-0px)] min-h-[640px]">
      <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3 border-b border-border bg-surface">
        <h1 className="text-lg font-bold mr-auto">Theme</h1>
        <span role="status" className={`text-sm ${save.state === "error" ? "text-critical" : "text-muted"}`}>{statusText}</span>
        <div className="flex gap-1" role="group" aria-label="History">
          <button type="button" className="btn btn-secondary" onClick={undo} disabled={!history.past.length} title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" className="btn btn-secondary" onClick={redo} disabled={!history.future.length} title="Redo (Ctrl+Shift+Z)">Redo</button>
        </div>
        <div className="flex gap-1" role="group" aria-label="Preview size">
          {(["desktop", "mobile"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={viewport === v} onClick={() => setViewport(v)}
              className={`btn ${viewport === v ? "btn-primary" : "btn-secondary"}`}>{v === "desktop" ? "Desktop" : "Phone"}</button>
          ))}
        </div>
        {unpublished && <button type="button" className="btn btn-secondary" onClick={discard}>Discard changes</button>}
        <a href={storeLink} target="_blank" className="btn btn-secondary">View live store ↗</a>
        <button type="button" className="btn btn-secondary" aria-expanded={later} onClick={() => setLater(!later)}>
          {schedule || revertAt ? "Schedule (set)" : "Schedule"}
        </button>
        <button type="button" className="btn btn-primary" onClick={publish} disabled={publishing || (!unpublished && save.state === "saved")}>
          {publishing ? "Publishing…" : "Publish"}
        </button>
      </div>
      {later && <SchedulePanel doc={doc} schedule={schedule} setSchedule={setSchedule} revertAt={revertAt} setRevertAt={setRevertAt} onClose={() => setLater(false)} />}

      <div className="flex-1 min-h-0 grid lg:grid-cols-[360px_1fr]">
        <aside className="border-r border-border bg-surface overflow-y-auto min-h-0">
          <div role="tablist" aria-label="Editor" className="flex border-b border-border sticky top-0 bg-surface z-10">
            {([["themes", "Themes"], ["sections", "Sections"], ["style", "Style"], ["menus", "Menus"], ["seo", "Search"]] as const).map(([k, label]) => (
              <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`flex-1 py-3 text-sm font-semibold border-b-2 ${tab === k ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="p-4 flex flex-col gap-4">
            {tab === "sections" && !current && (
              <SectionList doc={doc} onSelect={setSelected} onMove={moveSection} onToggle={(s) => updateSection(s.id, { hidden: !s.hidden })}
                onRemove={(s) => setSections(doc.home.filter((x) => x.id !== s.id))} onAdd={addSection} />
            )}
            {tab === "sections" && current && (
              <div className="flex flex-col gap-4">
                <button type="button" className="hint hover:text-ink self-start" onClick={() => setSelected(null)}>← All sections</button>
                <div>
                  <h2 className="font-bold">{SECTION_LABELS[current.type].name}</h2>
                  <p className="hint">{SECTION_LABELS[current.type].about}</p>
                </div>
                <SectionForm type={current.type} settings={current.settings} links={links} collections={collections} products={products}
                  onChange={(settings) => updateSection(current.id, { settings } as Partial<Section>)} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={current.hidden} onChange={() => updateSection(current.id, { hidden: !current.hidden })} />
                  Hide this section
                </label>
              </div>
            )}
            {tab === "themes" && <ThemesPanel doc={doc} onChange={change} shopName={shopName} />}
            {tab === "style" && <StylePanel doc={doc} onChange={change} />}
            {tab === "menus" && (
              <>
                <p className="hint">Menus link to your collections, pages and products. Add pages under Pages first.</p>
                <MenuEditor title="Header menu" items={doc.menus.header} links={links} onChange={(header) => change({ ...doc, menus: { ...doc.menus, header } })} />
                <MenuEditor title="Footer menu" items={doc.menus.footer} links={links} onChange={(footer) => change({ ...doc, menus: { ...doc.menus, footer } })} />
              </>
            )}
            {tab === "seo" && <SeoPanel doc={doc} onChange={change} storeLink={storeLink} />}
          </div>
          {published && <p className="hint px-4 pb-4">Last published {new Date(published).toLocaleString()}.</p>}
        </aside>

        <div className="bg-sunken min-h-[480px] flex justify-center overflow-auto p-0 lg:p-4">
          <iframe ref={frame} src="/admin/preview" title="Store preview" onLoad={post}
            className="bg-white h-full min-h-[480px] lg:rounded-lg lg:shadow-sm border-0 transition-[width]"
            style={{ width: PREVIEW_WIDTH[viewport] }} />
        </div>
      </div>
    </div>
  );
}

function SectionList({
  doc,
  onSelect,
  onMove,
  onToggle,
  onRemove,
  onAdd,
}: {
  doc: ThemeDoc;
  onSelect: (id: string) => void;
  onMove: (i: number, d: -1 | 1) => void;
  onToggle: (s: Section) => void;
  onRemove: (s: Section) => void;
  onAdd: (t: SectionType) => void;
}) {
  const addId = useId();
  return (
    <>
      <p className="hint">Your home page, top to bottom. Pick a section to edit it.</p>
      <ol className="flex flex-col gap-2">
        {doc.home.map((s, i) => (
          <li key={s.id} className={`card p-2 flex items-center gap-2 ${s.hidden ? "border-dashed bg-sunken" : ""}`}>
            <button type="button" className="flex-1 min-w-0 text-left px-2 py-1 rounded-md hover:bg-sunken" onClick={() => onSelect(s.id)}>
              <span className="block text-sm font-semibold truncate">{sectionTitle(s)}</span>
              <span className="block hint truncate">{SECTION_LABELS[s.type].name}{s.hidden ? " · hidden" : ""}</span>
            </button>
            <div className="flex items-center gap-1 text-xs">
              <button type="button" className="px-1.5 py-1 rounded hover:bg-sunken disabled:opacity-30" disabled={i === 0} onClick={() => onMove(i, -1)} aria-label="Move up">↑</button>
              <button type="button" className="px-1.5 py-1 rounded hover:bg-sunken disabled:opacity-30" disabled={i === doc.home.length - 1} onClick={() => onMove(i, 1)} aria-label="Move down">↓</button>
              <button type="button" className="px-1.5 py-1 rounded hover:bg-sunken" onClick={() => onToggle(s)} aria-label={s.hidden ? "Show" : "Hide"}>
                {s.hidden ? "Show" : "Hide"}
              </button>
              <button type="button" className="px-1.5 py-1 rounded hover:bg-critical-soft hover:text-critical" aria-label={`Remove ${SECTION_LABELS[s.type].name}`}
                onClick={() => confirm(`Remove "${sectionTitle(s)}"? You can undo this.`) && onRemove(s)}>✕</button>
            </div>
          </li>
        ))}
      </ol>
      <div className="field">
        <label className="label" htmlFor={addId}>Add a section</label>
        <select id={addId} className="input" value="" onChange={(e) => e.target.value && onAdd(e.target.value as SectionType)}>
          <option value="" disabled>Choose a section…</option>
          {SECTION_TYPES.map((t) => <option key={t} value={t}>{SECTION_LABELS[t].name}</option>)}
        </select>
      </div>
    </>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <input type="color" aria-label={`${label} picker`} value={value} onChange={(e) => onChange(e.target.value)} className="h-[2.375rem] w-12 rounded-md border border-border-strong bg-surface p-1" />
        <input id={id} className="input num" value={text} maxLength={7}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }} />
      </div>
    </div>
  );
}

function StylePanel({ doc, onChange }: { doc: ThemeDoc; onChange: (d: ThemeDoc) => void }) {
  const s = doc.settings;
  const set = (patch: Partial<ThemeDoc["settings"]>) => onChange({ ...doc, settings: { ...s, ...patch } });
  const setColor = (k: keyof ThemeDoc["settings"]["colors"], v: string) => set({ colors: { ...s.colors, [k]: v } });
  const ids = { heading: useId(), body: useId(), logo: useId(), logoUrl: useId(), layout: useId() };
  const textContrast = contrastRatio(s.colors.text, s.colors.background);
  const buttonContrast = contrastRatio(s.colors.accentText, s.colors.accent);
  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-3">
        <legend className="font-semibold mb-1">Colors</legend>
        <ColorField label="Background" value={s.colors.background} onChange={(v) => setColor("background", v)} />
        <ColorField label="Text" value={s.colors.text} onChange={(v) => setColor("text", v)} />
        <ColorField label="Buttons and links" value={s.colors.accent} onChange={(v) => setColor("accent", v)} />
        <ColorField label="Button text" value={s.colors.accentText} onChange={(v) => setColor("accentText", v)} />
        {textContrast < 4.5 && <p className="banner banner-critical">Text is hard to read on this background ({textContrast.toFixed(1)}:1). Aim for 4.5:1 or more.</p>}
        {buttonContrast < 4.5 && <p className="banner banner-critical">Button text is hard to read ({buttonContrast.toFixed(1)}:1). Aim for 4.5:1 or more.</p>}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="font-semibold mb-1">Fonts</legend>
        {([["headingFont", "Headings", ids.heading], ["bodyFont", "Body text", ids.body]] as const).map(([k, label, id]) => (
          <div key={k} className="field">
            <label className="label" htmlFor={id}>{label}</label>
            <select id={id} className="input" value={s[k]} onChange={(e) => set({ [k]: e.target.value as ThemeFont })}>
              {Object.entries(THEME_FONTS).map(([f, def]) => <option key={f} value={f}>{def.label}</option>)}
            </select>
          </div>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="font-semibold mb-1">Layout</legend>
        {LAYOUT_FIELDS.map(([k, label, options]) => (
          <div key={k} className="field">
            <label className="label" htmlFor={`${ids.layout}-${k}`}>{label}</label>
            <select id={`${ids.layout}-${k}`} className="input" value={String(s.layout[k])}
              onChange={(e) => set({ layout: { ...s.layout, [k]: k === "columns" ? Number(e.target.value) : e.target.value } as ThemeDoc["settings"]["layout"] })}>
              {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold mb-1">Corners</legend>
        <div className="flex gap-2">
          {(["square", "soft", "round"] as const).map((c) => (
            <label key={c} className="chip flex-1 justify-center">
              <input type="radio" name="corners" className="sr-only" checked={s.corners === c} onChange={() => set({ corners: c })} />
              {c === "square" ? "Square" : c === "soft" ? "Soft" : "Round"}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="font-semibold mb-1">Logo</legend>
        <div className="field">
          <label className="label" htmlFor={ids.logo}>Store name in the header</label>
          <input id={ids.logo} className="input" value={s.logoText} maxLength={60} placeholder="Uses your store name" onChange={(e) => set({ logoText: e.target.value })} />
        </div>
        <div className="field">
          <label className="label" htmlFor={ids.logoUrl}>Logo image (optional)</label>
          <input id={ids.logoUrl} className="input" type="url" placeholder="https://…" value={s.logoUrl} onChange={(e) => set({ logoUrl: e.target.value })} />
        </div>
      </fieldset>
    </div>
  );
}

const LAYOUT_FIELDS: [keyof ThemeDoc["settings"]["layout"], string, [string, string][]][] = [
  ["header", "Header", [["classic", "Logo left, menu beside it"], ["centered", "Logo in the middle, menu below"], ["minimal", "Logo left, menu behind a button"]]],
  ["productImage", "Product photos", [["square", "Square"], ["portrait", "Tall"], ["landscape", "Wide"]]],
  ["columns", "Products per row on computers", [["4", "4"], ["3", "3"]]],
  ["cards", "Product cards", [["plain", "Plain"], ["framed", "Framed"]]],
  ["buttons", "Buttons", [["filled", "Filled"], ["outline", "Outline"]]],
];

const HEADER_SHAPES = { classic: "Menu beside logo", centered: "Centered logo", minimal: "Menu button" } as const;

function ThemesPanel({ doc, onChange, shopName }: { doc: ThemeDoc; onChange: (d: ThemeDoc) => void; shopName: string }) {
  const [replace, setReplace] = useState(false);
  const [applied, setApplied] = useState<ThemePresetId | null>(null);
  const current = currentPreset(doc);
  return (
    <div className="flex flex-col gap-4">
      <p className="hint">Every theme is free. Switching keeps your logo, menus and search settings; fine-tune colors and layout under Style afterwards.</p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
        <span>Also replace my home page sections with the theme&apos;s starter ones</span>
      </label>
      {applied && <p className="banner banner-info" role="status">{THEME_PRESETS[applied].label} applied to your draft. Publish to make it live, or Undo.</p>}
      <ul className="flex flex-col gap-3">
        {THEME_PRESET_IDS.map((id) => {
          const p = THEME_PRESETS[id];
          const { colors, layout } = p.look;
          return (
            <li key={id} className="card overflow-hidden" aria-label={`${p.label} theme`}>
              <div className="h-20 p-3 flex flex-col justify-between" style={{ background: colors.background, color: colors.text }} aria-hidden>
                <div className={`flex items-center gap-2 text-xs font-bold ${layout.header === "centered" ? "justify-center" : "justify-between"}`}>
                  <span>Store</span>
                  {layout.header !== "centered" && <span className="opacity-60 font-normal">{layout.header === "classic" ? "Home  Shop" : "☰"}</span>}
                </div>
                <div className="flex items-end gap-1.5">
                  {Array.from({ length: layout.columns }).map((_, i) => (
                    <span key={i} className="flex-1 opacity-25" style={{ background: colors.text, aspectRatio: layout.productImage === "portrait" ? "3/4" : layout.productImage === "landscape" ? "4/3" : "1", maxHeight: 34, borderRadius: p.look.corners === "square" ? 0 : p.look.corners === "soft" ? 3 : 6 }} />
                  ))}
                  <span className="text-[10px] px-2 py-1 font-semibold" style={layout.buttons === "outline" ? { border: `1px solid ${colors.text}` } : { background: colors.accent, color: colors.accentText }}>Buy</span>
                </div>
              </div>
              <div className="p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{p.label}</h3>
                  {current === id && <span className="pill pill-success">Current</span>}
                </div>
                <p className="hint">{p.about}</p>
                <p className="hint">{THEME_FONTS[p.look.headingFont].label} · {HEADER_SHAPES[layout.header]} · {layout.columns} per row</p>
                <button type="button" className="btn btn-secondary self-start" disabled={current === id && !replace}
                  onClick={() => {
                    onChange(applyThemePreset(doc, id, { replaceSections: replace, shopName }));
                    setApplied(id);
                  }}>
                  Use {p.label}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SeoPanel({ doc, onChange, storeLink }: { doc: ThemeDoc; onChange: (d: ThemeDoc) => void; storeLink: string }) {
  const seo = doc.settings.seo;
  const set = (patch: Partial<typeof seo>) => onChange({ ...doc, settings: { ...doc.settings, seo: { ...seo, ...patch } } });
  const ids = { title: useId(), description: useId() };
  return (
    <div className="flex flex-col gap-4">
      <p className="hint">How your home page shows up in search results and when someone shares a link.</p>
      <div className="field">
        <label className="label" htmlFor={ids.title}>Page title</label>
        <input id={ids.title} className="input" value={seo.title} maxLength={70} onChange={(e) => set({ title: e.target.value })} placeholder="Uses your store name" />
        <span className="hint num">{seo.title.length} of 70</span>
      </div>
      <div className="field">
        <label className="label" htmlFor={ids.description}>Description</label>
        <textarea id={ids.description} className="input" rows={4} value={seo.description} maxLength={320} onChange={(e) => set({ description: e.target.value })} />
        <span className="hint num">{seo.description.length} of 320. Search engines usually show about 155.</span>
      </div>
      <div className="card p-3 flex flex-col gap-1" aria-label="Search result preview">
        <span className="text-xs text-muted truncate">{storeLink.replace(/^https?:\/\//, "")}</span>
        <span className="text-info font-medium truncate">{seo.title || "Your store name"}</span>
        <span className="text-sm text-muted line-clamp-2">{seo.description || "Add a description so buyers know what you sell."}</span>
      </div>
      <p className="hint">Products, collections and pages get their own titles from their names. A sitemap is published for you at /sitemap.xml.</p>
    </div>
  );
}
