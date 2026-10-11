"use client";
// Loads the store's ad tags (Meta, TikTok, Google) once the buyer agrees, or straight away where
// no agreement is needed, and passes on what buyers do. Pages report events with `pixelEvent`;
// they wait in a queue until the tags are allowed to load, and are dropped if the buyer says no.
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export const CONSENT_COOKIE = "sf_consent";

export type PixelEventName = "view_item" | "add_to_cart" | "begin_checkout" | "purchase";
export type PixelEventData = { ids: string[]; value: number; currency: string; orderId?: string };
type Ids = { meta: string | null; tiktok: string | null; google: string | null };

type Fn = ((...args: unknown[]) => void) & Record<string, unknown>;
type PixelWindow = Window & { __sfPixelQueue?: [PixelEventName, PixelEventData][]; fbq?: Fn; _fbq?: Fn; ttq?: unknown[] & Record<string, unknown>; dataLayer?: unknown[]; gtag?: Fn };
const w = () => window as PixelWindow;

/** Reports something a buyer did to the store's ad tags. Safe to call when there are none. */
export function pixelEvent(name: PixelEventName, data: PixelEventData) {
  try {
    const q = (w().__sfPixelQueue ??= []);
    if (q.length < 50) q.push([name, data]);
    window.dispatchEvent(new Event("sf:pixel"));
  } catch {}
}

function addScript(src: string) {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

// The platforms' own loader snippets, written out.
function loadMeta(id: string) {
  const win = w();
  if (win.fbq) return;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) (fbq.callMethod as (...a: unknown[]) => void)(...args);
    else (fbq.queue as unknown[]).push(args);
  } as Fn;
  Object.assign(fbq, { push: fbq, loaded: true, version: "2.0", queue: [] });
  win.fbq = win._fbq = fbq;
  addScript("https://connect.facebook.net/en_US/fbevents.js");
  fbq("init", id);
}

function loadTikTok(id: string) {
  const win = w();
  if (win.ttq) return;
  const ttq = [] as unknown as unknown[] & Record<string, unknown>;
  const methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
  const defer = (t: Record<string, unknown> & unknown[], m: string) => {
    t[m] = (...args: unknown[]) => t.push([m, ...args]);
  };
  for (const m of methods) defer(ttq, m);
  ttq.instance = (k: string) => {
    const inst = ((ttq._i as Record<string, unknown[]>)[k] ?? []) as unknown[] & Record<string, unknown>;
    for (const m of methods) defer(inst, m);
    return inst;
  };
  const src = "https://analytics.tiktok.com/i18n/pixel/events.js";
  ttq._i = { [id]: Object.assign([], { _u: src }) };
  ttq._t = { [id]: Date.now() };
  ttq._o = { [id]: {} };
  (window as unknown as Record<string, unknown>).TiktokAnalyticsObject = "ttq";
  win.ttq = ttq;
  addScript(`${src}?sdkid=${id}&lib=ttq`);
}

function loadGoogle(id: string) {
  const win = w();
  if (win.gtag) return;
  win.dataLayer = win.dataLayer ?? [];
  // gtag needs the arguments object itself, not an array.
  win.gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    win.dataLayer!.push(arguments);
  } as unknown as Fn;
  addScript(`https://www.googletagmanager.com/gtag/js?id=${id}`);
  win.gtag("js", new Date());
  win.gtag("config", id);
}

const META_NAMES: Record<PixelEventName, string> = { view_item: "ViewContent", add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "Purchase" };
const TIKTOK_NAMES: Record<PixelEventName, string> = { view_item: "ViewContent", add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "CompletePayment" };

function send(ids: Ids, name: PixelEventName, d: PixelEventData) {
  const win = w();
  // A purchase is reported once, however often the order page is opened.
  if (name === "purchase" && d.orderId) {
    const key = `sf_px_${d.orderId}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {}
  }
  const value = Math.round(d.value * 100) / 100;
  if (ids.meta) win.fbq?.("track", META_NAMES[name], { content_ids: d.ids, content_type: "product", value, currency: d.currency });
  if (ids.tiktok) (win.ttq?.track as Fn | undefined)?.(TIKTOK_NAMES[name], { contents: d.ids.map((id) => ({ content_id: id, content_type: "product" })), value, currency: d.currency });
  if (ids.google) win.gtag?.("event", name, { currency: d.currency, value, transaction_id: d.orderId, items: d.ids.map((id) => ({ item_id: id })) });
}

function readConsent(): "yes" | "no" | null {
  const v = document.cookie.match(/(?:^|; )sf_consent=(yes|no)/)?.[1];
  return (v as "yes" | "no" | undefined) ?? null;
}

export function AdPixels({ ids, ask, text }: { ids: Ids; ask: boolean; text: { message: string; accept: string; decline: string; settings: string } }) {
  const path = usePathname();
  // Unknown until the cookie is read in the browser.
  const [consent, setConsent] = useState<"yes" | "no" | null | undefined>(undefined);
  useEffect(() => setConsent(ask ? readConsent() : "yes"), [ask]);
  const allowed = consent === "yes";

  // Load the tags once allowed, and count each page.
  useEffect(() => {
    if (!allowed) return;
    try {
      const first = !w().fbq && !w().ttq && !w().gtag;
      if (ids.meta) loadMeta(ids.meta);
      if (ids.tiktok) loadTikTok(ids.tiktok);
      if (ids.google) loadGoogle(ids.google);
      if (ids.meta) w().fbq?.("track", "PageView");
      if (ids.tiktok) (w().ttq?.page as Fn | undefined)?.();
      // Google counts the first page itself when it's set up.
      if (ids.google && !first) w().gtag?.("event", "page_view", { page_location: location.href });
    } catch {}
  }, [allowed, ids.meta, ids.tiktok, ids.google, path]);

  // Pass on what buyers do: events from pages, and add-to-cart forms as they're sent.
  useEffect(() => {
    if (consent === undefined || consent === null) return;
    const drain = () => {
      const q = w().__sfPixelQueue ?? [];
      const events = q.splice(0, q.length);
      if (allowed) for (const [name, data] of events) send(ids, name, data);
    };
    const onSubmit = (e: SubmitEvent) => {
      // Add-to-cart forms carry data-pixel-prices (option id to price) and data-pixel-currency.
      const form = e.target as HTMLFormElement | null;
      const el = form?.dataset;
      if (!el?.pixelPrices || !el.pixelCurrency) return;
      // The option picked (a hidden field or a radio group) and its price.
      const id = (form!.elements.namedItem("variantId") as HTMLInputElement | RadioNodeList | null)?.value;
      const prices = JSON.parse(el.pixelPrices) as Record<string, number>;
      if (!id || prices[id] === undefined) return;
      const quantity = Number((form!.elements.namedItem("quantity") as HTMLInputElement | null)?.value) || 1;
      pixelEvent("add_to_cart", { ids: [id], value: prices[id] * quantity, currency: el.pixelCurrency });
    };
    drain();
    window.addEventListener("sf:pixel", drain);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      window.removeEventListener("sf:pixel", drain);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [consent, allowed, ids]);

  const choose = (v: "yes" | "no") => {
    const before = readConsent();
    document.cookie = `${CONSENT_COOKIE}=${v}; path=/; max-age=${180 * 86_400}; samesite=lax`;
    // Taking it back means reloading without the tags.
    if (v === "no" && before === "yes") location.reload();
    else setConsent(v);
  };

  if (!ask || consent === undefined) return null;
  if (consent === null) {
    return (
      <div role="region" aria-label={text.settings} className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4">
        <div className="mx-auto max-w-3xl card p-4 flex flex-col sm:flex-row gap-3 sm:items-center shadow-lg">
          <p className="text-sm flex-1">{text.message}</p>
          <div className="flex gap-2 shrink-0">
            <button type="button" className="btn btn-secondary" onClick={() => choose("no")}>{text.decline}</button>
            <button type="button" className="btn btn-primary" onClick={() => choose("yes")}>{text.accept}</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2 text-center">
      <button type="button" className="hint text-xs underline" onClick={() => setConsent(null)}>{text.settings}</button>
    </div>
  );
}
