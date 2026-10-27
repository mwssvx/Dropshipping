"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { shopperLinks } from "@sf/core/shopper-links";
import type { ShopAssistantCard, ShopAssistantState } from "@/app/s/[shop]/actions";

type Line = { from: "shopper" | "assistant"; body: string; cards?: ShopAssistantCard[] };
type Text = { open: string; title: string; intro: string; placeholder: string; send: string; close: string; thinking: string; error: string; note: string; addToCart: string; soldOut: string; from: string };

/** "Ask us" on every store page: a small chat with the store's shopping assistant. */
export function ShopAssistant(props: {
  base: string;
  /** Where the browser keeps the chat's id, one per store. */
  storageKey: string;
  t: Text;
  ask: (chatId: string | null, question: string, productHandle: string | null) => Promise<ShopAssistantState>;
  load: (chatId: string) => Promise<Line[]>;
  /** Adds one of a single-option product to the cart, then shows the cart. */
  addToCart: (form: FormData) => void;
}) {
  const { t } = props;
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const chatId = useRef<string | null>(null);
  const loaded = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const path = usePathname();
  const productHandle = path.match(/\/products\/([a-z0-9-]+)\/?$/)?.[1] ?? null;

  // Braces matter: newer browsers return a promise from scrollIntoView, and React would call it as a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines, pending, open]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    // The chat so far, from another page or an earlier visit. Storage can be blocked; then it starts fresh.
    if (loaded.current) return;
    loaded.current = true;
    try {
      chatId.current = window.localStorage.getItem(props.storageKey);
    } catch {}
    if (chatId.current) props.load(chatId.current).then((l) => setLines((now) => (now.length ? now : l)), () => {});
  }, [open, props]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const question = input.current?.value.trim() ?? "";
    if (!question || pending) return;
    setError(null);
    setLines((l) => [...l, { from: "shopper", body: question }]);
    input.current!.value = "";
    start(async () => {
      const r = await props.ask(chatId.current, question, productHandle).catch(() => ({ error: t.error }) as ShopAssistantState);
      if (r.chatId && r.chatId !== chatId.current) {
        chatId.current = r.chatId;
        try {
          window.localStorage.setItem(props.storageKey, r.chatId);
        } catch {}
      }
      if (r.reply) setLines((l) => [...l, { from: "assistant", body: r.reply!, cards: r.cards }]);
      else setError(r.error ?? t.error);
    });
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary fixed bottom-4 right-4 z-40 shadow-lg rounded-full px-5" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {t.open}
      </button>
    );
  }
  return (
    <section role="dialog" aria-label={t.title} className="card fixed bottom-4 right-4 left-4 sm:left-auto z-40 sm:w-96 max-h-[min(36rem,calc(100dvh-2rem))] flex flex-col shadow-xl p-0">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <h2 className="font-semibold">{t.title}</h2>
        <button type="button" className="hint hover:text-ink" onClick={() => setOpen(false)} aria-label={t.close}>✕</button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 text-sm" aria-live="polite">
        <p className="hint">{t.intro}</p>
        {lines.map((l, i) =>
          l.from === "shopper" ? (
            <p key={i} className="self-end max-w-[85%] rounded-2xl bg-sunken px-3 py-2 whitespace-pre-line">{l.body}</p>
          ) : (
            <div key={i} className="self-start max-w-[90%] flex flex-col gap-2">
              <p className="whitespace-pre-line">
                {shopperLinks(l.body).map((part, j) =>
                  "handle" in part ? <a key={j} className="underline font-medium" href={`${props.base}/products/${part.handle}`}>{part.text}</a> : <span key={j}>{part.text}</span>,
                )}
              </p>
              {l.cards?.map((c) => (
                <article key={c.handle} aria-label={c.title} className="flex gap-3 items-center rounded-lg border border-border p-2">
                  {c.imageUrl ? <img src={c.imageUrl} alt="" className="size-12 rounded object-cover shrink-0" /> : <span className="size-12 rounded bg-sunken shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <a className="font-medium block truncate" href={`${props.base}/products/${c.handle}`}>{c.title}</a>
                    <span className="num">{c.from && `${t.from} `}{c.price}</span>{c.was && <s className="hint num ml-2">{c.was}</s>}
                    {!c.inStock && <span className="hint block">{t.soldOut}</span>}
                  </div>
                  {c.variantId && (
                    <form action={props.addToCart}>
                      <input type="hidden" name="variantId" value={c.variantId} />
                      <input type="hidden" name="quantity" value="1" />
                      <button type="submit" className="btn text-xs px-2 py-1" aria-label={`${t.addToCart}: ${c.title}`}>{t.addToCart}</button>
                    </form>
                  )}
                </article>
              ))}
            </div>
          ),
        )}
        {pending && <p className="hint" role="status">{t.thinking}</p>}
        {error && <p className="text-critical" role="alert">{error}</p>}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="border-t border-border p-3 flex flex-col gap-2">
        <div className="flex gap-2 items-end">
          <label className="sr-only" htmlFor="shop-assistant-q">{t.placeholder}</label>
          <textarea
            id="shop-assistant-q"
            ref={input}
            rows={2}
            maxLength={500}
            className="input flex-1 resize-none h-16 min-h-0"
            placeholder={t.placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) send(e);
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={pending}>{t.send}</button>
        </div>
        <p className="hint text-xs">{t.note}</p>
      </form>
    </section>
  );
}
