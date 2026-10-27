// Selling in more currencies. Prices stay in the store's currency; buyers can see and pay in USD,
// GBP, EUR or CAD at the day's reference rate (European Central Bank), with no markup from us.
import { schema, type Db, type Presentment } from "@sf/db";
import { eq } from "drizzle-orm";
import { convertAmount, convertPrice, noConversion, type DisplayFx } from "./money";
import { UserError } from "./errors";

export const CURRENCIES = ["USD", "GBP", "EUR", "CAD"] as const;
export const CURRENCY_NAMES: Record<string, string> = { USD: "US dollar", GBP: "British pound", EUR: "Euro", CAD: "Canadian dollar" };

/** Rates as units per euro, the way the European Central Bank publishes them. */
export type EuroRates = Record<string, number>;

export type RateSheet = { rates: EuroRates; asOf: string };

export interface FxProvider {
  readonly name: string;
  rates(): Promise<RateSheet>;
}

/** Fixed rates for development and tests. */
export class StaticFx implements FxProvider {
  readonly name = "static";
  constructor(private table: EuroRates = { EUR: 1, USD: 1.08, GBP: 0.85, CAD: 1.47 }) {}
  async rates() {
    return { rates: this.table, asOf: "fixed rates for testing" };
  }
}

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** The European Central Bank's daily reference rates, fetched at most every 6 hours. */
export class EcbFx implements FxProvider {
  readonly name = "ecb";
  private cached: { at: number; sheet: RateSheet } | null = null;
  constructor(private fallback: FxProvider = new StaticFx(), private fetcher: typeof fetch = fetch) {}

  async rates() {
    if (this.cached && Date.now() - this.cached.at < 6 * 3_600_000) return this.cached.sheet;
    try {
      const res = await this.fetcher(ECB_URL, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`ECB answered ${res.status}`);
      const sheet = parseEcb(await res.text());
      this.cached = { at: Date.now(), sheet };
      return sheet;
    } catch (e) {
      console.error("Exchange rates unavailable; using the last known ones.", e);
      return this.cached?.sheet ?? this.fallback.rates();
    }
  }
}

export function parseEcb(xml: string): RateSheet {
  const rates: EuroRates = { EUR: 1 };
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]!] = Number(m[2]);
  for (const c of CURRENCIES) if (!(rates[c]! > 0)) throw new Error(`No ${c} rate in the ECB file`);
  const day = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/);
  return { rates, asOf: day?.[1] ?? "today" };
}

export function fxFromEnv(env: Record<string, string | undefined>): FxProvider {
  return env.FX_PROVIDER === "static" ? new StaticFx() : new EcbFx();
}

/** Buyer currency units per store currency unit. */
export function crossRate(rates: EuroRates, from: string, to: string) {
  if (from === to) return 1;
  return rates[to]! / rates[from]!;
}

type ShopFx = { currency: string; presentmentCurrencies: string[]; roundConvertedPrices: boolean };

/** The currencies a store's buyers can pick from, its own first. */
export function shopCurrencies(shop: ShopFx) {
  return [shop.currency, ...shop.presentmentCurrencies.filter((c) => c !== shop.currency)];
}

/** How to show prices to a buyer who asked for a currency. Unknown or turned-off ones fall back. */
export async function displayFx(fx: FxProvider, shop: ShopFx, wanted: string | null | undefined): Promise<DisplayFx> {
  if (!wanted || wanted === shop.currency || !shop.presentmentCurrencies.includes(wanted)) return noConversion(shop.currency);
  const { rates } = await fx.rates();
  return { currency: wanted, rate: Number(crossRate(rates, shop.currency, wanted).toFixed(6)), round: shop.roundConvertedPrices };
}

/** The buyer's own currency from their country, when the store sells in it. */
export function currencyForCountry(shop: ShopFx, country: string | null | undefined): string | null {
  if (!country) return null;
  const byCountry: Record<string, string> = { US: "USD", GB: "GBP", CA: "CAD" };
  const EURO = ["AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES"];
  const c = byCountry[country.toUpperCase()] ?? (EURO.includes(country.toUpperCase()) ? "EUR" : null);
  return c && shopCurrencies(shop).includes(c) ? c : null;
}

/**
 * A cart quote in the buyer's currency. Each item price is converted the way the store shows it,
 * so the total is exactly what the buyer saw.
 */
export function presentQuote(
  quote: { items: { variantId: string; unitPriceMinor: number; quantity: number }[]; discountMinor: number; shippingMinor: number; taxMinor: number; pricesIncludeTax: boolean; protectionMinor?: number; giftWrapMinor?: number },
  fx: DisplayFx,
): Presentment {
  const units = Object.fromEntries(quote.items.map((i) => [i.variantId, convertPrice(i.unitPriceMinor, fx)]));
  const subtotalMinor = quote.items.reduce((s, i) => s + units[i.variantId]! * i.quantity, 0);
  const discountMinor = Math.min(subtotalMinor, convertAmount(quote.discountMinor, fx));
  const shippingMinor = convertAmount(quote.shippingMinor, fx);
  const taxMinor = convertAmount(quote.taxMinor, fx);
  const protectionMinor = quote.protectionMinor ? convertAmount(quote.protectionMinor, fx) : 0;
  const giftWrapMinor = quote.giftWrapMinor ? convertAmount(quote.giftWrapMinor, fx) : 0;
  return {
    currency: fx.currency,
    rate: fx.rate,
    units,
    subtotalMinor,
    discountMinor,
    shippingMinor,
    ...(protectionMinor ? { protectionMinor } : {}),
    ...(giftWrapMinor ? { giftWrapMinor } : {}),
    taxMinor,
    totalMinor: subtotalMinor - discountMinor + shippingMinor + protectionMinor + giftWrapMinor + (quote.pricesIncludeTax ? 0 : taxMinor),
  };
}

export async function setShopCurrencies(db: Db, shop: { id: string; currency: string }, input: { currencies: string[]; round: boolean }) {
  const extra = [...new Set(input.currencies)].filter((c) => c !== shop.currency);
  for (const c of extra) if (!(CURRENCIES as readonly string[]).includes(c)) throw new UserError(`We don't support ${c} yet.`);
  await db.update(schema.shops).set({ presentmentCurrencies: extra, roundConvertedPrices: input.round, updatedAt: new Date() }).where(eq(schema.shops.id, shop.id));
}

type OrderAmounts = {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  protectionMinor?: number;
  giftWrapMinor?: number;
  taxMinor: number;
  totalMinor: number;
  refundedMinor: number;
  presentment: Presentment | null;
  /** Paid with a gift card (store currency only, so never with a presentment). */
  giftCardMinor?: number;
};

/**
 * An order's amounts as the buyer saw and paid them: in their own currency when they shopped in
 * one, otherwise the store's. For receipts, order pages and the buyer's account.
 */
export function buyerAmounts(order: OrderAmounts, lines: { variantId: string | null; unitPriceMinor: number; quantity: number }[] = [], refundedPresentmentMinor?: number) {
  const p = order.presentment;
  if (!p) {
    return {
      currency: order.currency,
      lines: lines.map((l) => l.unitPriceMinor * l.quantity),
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      shippingMinor: order.shippingMinor,
      protectionMinor: order.protectionMinor ?? 0,
      giftWrapMinor: order.giftWrapMinor ?? 0,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      refundedMinor: order.refundedMinor,
      giftCardMinor: order.giftCardMinor ?? 0,
      /** What the card was charged. */
      chargedMinor: order.totalMinor - (order.giftCardMinor ?? 0),
    };
  }
  const fx = { currency: p.currency, rate: p.rate, round: false };
  return {
    currency: p.currency,
    lines: lines.map((l) => (l.variantId && p.units[l.variantId] !== undefined ? p.units[l.variantId]! : convertAmount(l.unitPriceMinor, fx)) * l.quantity),
    subtotalMinor: p.subtotalMinor,
    discountMinor: p.discountMinor,
    shippingMinor: p.shippingMinor,
    protectionMinor: p.protectionMinor ?? 0,
    giftWrapMinor: p.giftWrapMinor ?? 0,
    taxMinor: p.taxMinor,
    totalMinor: p.totalMinor,
    giftCardMinor: 0,
    chargedMinor: p.totalMinor,
    refundedMinor: refundedPresentmentMinor ?? Math.min(p.totalMinor, order.refundedMinor >= order.totalMinor ? p.totalMinor : convertAmount(order.refundedMinor, fx)),
  };
}
