import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import Stripe from "stripe";
import { schema, type Address, type Db, type TaxBreakdownLine } from "@sf/db";
import { UserError } from "./errors";

type Shop = typeof schema.shops.$inferSelect;

/*
 * Sales tax and VAT. A store charges tax only where it has told us it's registered: "GB" (UK VAT),
 * "EU" (one OSS/IOSS registration covering every EU country at the buyer's rate), "CA" (GST/HST)
 * or a US state like "US-TX". Built-in rates cover the national and state level; with Stripe Tax
 * switched on, Stripe works out the exact rate (US cities and counties, product exemptions).
 */

// Standard VAT rates in percent, as of 2026.
export const EU_VAT: Record<string, number> = {
  AT: 20, BE: 21, BG: 20, HR: 25, CY: 19, CZ: 21, DK: 25, EE: 24, FI: 25.5, FR: 20, DE: 19, GR: 24, HU: 27, IE: 23,
  IT: 22, LV: 21, LT: 21, LU: 17, MT: 18, NL: 21, PL: 23, PT: 23, RO: 21, SK: 23, SI: 22, ES: 21, SE: 25,
};
// Harmonized sales tax provinces; elsewhere in Canada GST is 5% (provincial PST/QST isn't built in).
const CA_HST: Record<string, number> = { ON: 13, NB: 15, NS: 14, NL: 15, PE: 15 };
// State-level sales tax. Local rates come on top and are only included with Stripe Tax.
const US_STATE: Record<string, number> = {
  AL: 4, AZ: 5.6, AR: 6.5, CA: 7.25, CO: 2.9, CT: 6.35, DC: 6, FL: 6, GA: 4, HI: 4, ID: 6, IL: 6.25, IN: 7, IA: 6,
  KS: 6.5, KY: 6, LA: 5, ME: 5.5, MD: 6, MA: 6.25, MI: 6, MN: 6.875, MS: 7, MO: 4.225, NE: 5.5, NV: 6.85, NJ: 6.625,
  NM: 4.875, NY: 4, NC: 4.75, ND: 5, OH: 5.75, OK: 4.5, PA: 6, RI: 7, SC: 6, SD: 4.2, TN: 7, TX: 6.25, UT: 6.1,
  VT: 6, VA: 5.3, WA: 6.5, WV: 6, WI: 5, WY: 4, AK: 0, DE: 0, MT: 0, NH: 0, OR: 0,
};

const US_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const CA_NAMES: Record<string, string> = {
  alberta: "AB", "british columbia": "BC", manitoba: "MB", "new brunswick": "NB", "newfoundland and labrador": "NL",
  newfoundland: "NL", "nova scotia": "NS", ontario: "ON", "prince edward island": "PE", quebec: "QC", québec: "QC",
  saskatchewan: "SK", "northwest territories": "NT", nunavut: "NU", yukon: "YT",
};
const CA_CODES = new Set(Object.values(CA_NAMES));

/** "Texas", "tx" or "TX." → "TX". Null when it isn't a US state or Canadian province we know. */
export function regionCode(country: string, region: string | null | undefined): string | null {
  const r = (region ?? "").trim().replace(/\.$/, "");
  if (!r) return null;
  if (country === "US") {
    const code = r.length === 2 ? r.toUpperCase() : US_NAMES[r.toLowerCase()];
    return code && code in US_STATE ? code : null;
  }
  if (country === "CA") {
    const code = r.length === 2 ? r.toUpperCase() : CA_NAMES[r.toLowerCase()];
    return code && CA_CODES.has(code) ? code : null;
  }
  return null;
}

/** The places a store can register, with names merchants recognise. */
export const TAX_JURISDICTIONS: { code: string; name: string; note: string }[] = [
  { code: "GB", name: "United Kingdom (VAT)", note: "Sellers outside the UK must register from the first sale of goods under £135." },
  { code: "EU", name: "European Union (VAT OSS / IOSS)", note: "One registration covers every EU country; each buyer is charged their own country's rate." },
  { code: "CA", name: "Canada (GST/HST)", note: "Charges 5% GST, or HST in Ontario and the Atlantic provinces. Provincial PST and QST aren't included." },
  ...Object.entries(US_NAMES)
    .filter(([, code]) => US_STATE[code]! > 0)
    .map(([name, code]) => ({
      code: `US-${code}`,
      name: `${name.replace(/\b\w/g, (c) => c.toUpperCase()).replace(" Of ", " of ")} (sales tax)`,
      note: "Register once your sales into this state pass its threshold (often $100,000 a year).",
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
];
const KNOWN = new Set(TAX_JURISDICTIONS.map((j) => j.code));

/** Which registration applies to a buyer at this address, and the rate. Null: no tax charged. */
export function taxRateFor(address: Pick<Address, "country" | "region">, registered: Iterable<string>): { jurisdiction: string; label: string; ratePct: number } | null {
  const regs = new Set(registered);
  const c = address.country.toUpperCase();
  if (c === "GB" && regs.has("GB")) return { jurisdiction: "GB", label: "VAT", ratePct: 20 };
  if (c in EU_VAT && regs.has("EU")) return { jurisdiction: `EU-${c}`, label: `VAT (${c})`, ratePct: EU_VAT[c]! };
  if (c === "CA" && regs.has("CA")) {
    const p = regionCode("CA", address.region);
    if (p && p in CA_HST) return { jurisdiction: `CA-${p}`, label: "HST", ratePct: CA_HST[p]! };
    return { jurisdiction: "CA", label: "GST", ratePct: 5 };
  }
  if (c === "US") {
    const s = regionCode("US", address.region);
    if (s && regs.has(`US-${s}`) && US_STATE[s]! > 0) return { jurisdiction: `US-${s}`, label: `Sales tax (${s})`, ratePct: US_STATE[s]! };
  }
  return null;
}

export type TaxInput = {
  currency: string;
  lines: { reference: string; amountMinor: number }[];
  shippingMinor: number;
  address: Address;
  pricesIncludeTax: boolean;
  /** The store's payout account; Stripe Tax uses its registrations. */
  accountId: string | null;
  registrations: string[];
};
export type TaxResult = { taxMinor: number; included: boolean; breakdown: TaxBreakdownLine[]; calculationId: string | null };

export interface TaxCalculator {
  readonly name: "builtin" | "stripe";
  calculate(input: TaxInput): Promise<TaxResult>;
  /** Tell the tax service the order went through, so it shows up in its filing reports. */
  record(calculationId: string, orderReference: string): Promise<void>;
  /** Register the store with the tax service too. Returns its id for the registration. */
  register(accountId: string | null, jurisdiction: string, homeCountry: string): Promise<string | null>;
}

/** Tax on one amount at a rate in basis points: added on top, or taken out of a price that includes it. */
export function taxOn(amountMinor: number, rateBps: number, included: boolean) {
  if (included) return amountMinor - Math.round((amountMinor * 10_000) / (10_000 + rateBps));
  return Math.round((amountMinor * rateBps) / 10_000);
}

export class BuiltInTaxCalculator implements TaxCalculator {
  readonly name = "builtin" as const;

  async calculate(input: TaxInput): Promise<TaxResult> {
    const rate = taxRateFor(input.address, input.registrations);
    if (!rate) return { taxMinor: 0, included: input.pricesIncludeTax, breakdown: [], calculationId: null };
    const bps = Math.round(rate.ratePct * 100);
    // Shipping is taxed like the goods in the UK, EU and Canada; most US states don't tax separately stated shipping.
    const taxShipping = !rate.jurisdiction.startsWith("US-");
    const amounts = [...input.lines.map((l) => l.amountMinor), ...(taxShipping ? [input.shippingMinor] : [])];
    const taxMinor = amounts.reduce((s, a) => s + taxOn(a, bps, input.pricesIncludeTax), 0);
    return {
      taxMinor,
      included: input.pricesIncludeTax,
      breakdown: taxMinor ? [{ jurisdiction: rate.jurisdiction, label: `${rate.label} ${rate.ratePct}%`, rateBps: bps, amountMinor: taxMinor }] : [],
      calculationId: null,
    };
  }

  async record() {}

  async register() {
    return null;
  }
}

/** Stripe Tax on the store's own Connect account, so the merchant is the seller of record. Untested until Stripe keys exist. */
export class StripeTaxCalculator implements TaxCalculator {
  readonly name = "stripe" as const;
  private readonly stripe: Stripe;
  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey);
  }

  async calculate(input: TaxInput): Promise<TaxResult> {
    if (!input.accountId) return new BuiltInTaxCalculator().calculate(input);
    const behavior = input.pricesIncludeTax ? "inclusive" : "exclusive";
    const a = input.address;
    const calc = await this.stripe.tax.calculations.create(
      {
        currency: input.currency.toLowerCase(),
        line_items: input.lines.map((l) => ({ amount: l.amountMinor, reference: l.reference, tax_behavior: behavior })),
        shipping_cost: input.shippingMinor ? { amount: input.shippingMinor, tax_behavior: behavior } : undefined,
        customer_details: {
          address: { line1: a.line1, line2: a.line2, city: a.city, state: a.region, postal_code: a.postalCode, country: a.country },
          address_source: "shipping",
        },
      },
      { stripeAccount: input.accountId },
    );
    const taxMinor = input.pricesIncludeTax ? calc.tax_amount_inclusive : calc.tax_amount_exclusive;
    return {
      taxMinor,
      included: input.pricesIncludeTax,
      calculationId: calc.id ?? null,
      breakdown: (calc.tax_breakdown ?? [])
        .filter((b) => b.amount > 0)
        .map((b) => {
          const d = b.tax_rate_details;
          const place = [d.country, d.state].filter(Boolean).join("-");
          return {
            jurisdiction: place || "unknown",
            label: `${(d.tax_type ?? "tax").replace(/_/g, " ").toUpperCase()} ${d.percentage_decimal}%`,
            rateBps: Math.round(Number(d.percentage_decimal) * 100),
            amountMinor: b.amount,
          };
        }),
    };
  }

  async record(calculationId: string, orderReference: string) {
    await this.stripe.tax.transactions.createFromCalculation({ calculation: calculationId, reference: orderReference });
  }

  async register(accountId: string | null, jurisdiction: string, homeCountry: string) {
    if (!accountId) throw new UserError("Set up payouts first, so the registration can be added to your payment account.");
    const [country, state] = jurisdiction.split("-") as [string, string | undefined];
    let options: Stripe.Tax.RegistrationCreateParams.CountryOptions;
    let target = country.toLowerCase();
    if (country === "US") options = { us: { state: state!, type: "state_sales_tax" } };
    else if (country === "GB") options = { gb: { type: "standard" } };
    else if (country === "CA") options = { ca: { type: homeCountry === "CA" ? "standard" : "simplified" } };
    else {
      // EU: OSS from the store's home EU country, IOSS (imports) from anywhere else.
      const home = homeCountry.toLowerCase();
      target = home in lowerKeys(EU_VAT) ? home : "ie";
      options = { [target]: { type: home in lowerKeys(EU_VAT) ? "oss_union" : "ioss" } } as Stripe.Tax.RegistrationCreateParams.CountryOptions;
    }
    const reg = await this.stripe.tax.registrations.create(
      { country: target.toUpperCase(), country_options: options, active_from: "now" },
      { stripeAccount: accountId },
    );
    return reg.id;
  }
}

const lowerKeys = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(o).map((k) => [k.toLowerCase(), true]));

export function taxCalculatorFromEnv(env: Record<string, string | undefined>): TaxCalculator {
  if (env.PAYMENTS_PROVIDER === "stripe" && env.STRIPE_TAX === "on" && env.STRIPE_SECRET_KEY) return new StripeTaxCalculator(env.STRIPE_SECRET_KEY);
  return new BuiltInTaxCalculator();
}

// Registrations and settings --------------------------------------------------------------------

export async function listTaxRegistrations(db: Db, shopId: string) {
  return db.query.taxRegistrations.findMany({ where: eq(schema.taxRegistrations.shopId, shopId), orderBy: schema.taxRegistrations.jurisdiction });
}

export async function addTaxRegistration(db: Db, tax: TaxCalculator, shop: Shop, input: { jurisdiction: string; registrationNumber?: string }) {
  const jurisdiction = input.jurisdiction.trim().toUpperCase();
  if (!KNOWN.has(jurisdiction)) throw new UserError("Choose where you're registered.");
  const number = input.registrationNumber?.trim().slice(0, 40) || null;
  const existing = await db.query.taxRegistrations.findFirst({
    where: and(eq(schema.taxRegistrations.shopId, shop.id), eq(schema.taxRegistrations.jurisdiction, jurisdiction)),
  });
  if (existing) throw new UserError("You've already added that one.");
  const providerRegistrationId = await tax.register(shop.paymentsAccountId, jurisdiction, shop.country);
  const [row] = await db
    .insert(schema.taxRegistrations)
    .values({ shopId: shop.id, jurisdiction, registrationNumber: number, providerRegistrationId })
    .onConflictDoNothing()
    .returning();
  return row ?? existing!;
}

export async function removeTaxRegistration(db: Db, shopId: string, id: string) {
  await db.delete(schema.taxRegistrations).where(and(eq(schema.taxRegistrations.id, id), eq(schema.taxRegistrations.shopId, shopId)));
}

export async function setPricesIncludeTax(db: Db, shopId: string, value: boolean) {
  await db.update(schema.shops).set({ pricesIncludeTax: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
}

/**
 * Tax collected per place over a period, after refunds: what the merchant files and pays.
 * Built from orders, so it works the same with built-in rates and Stripe Tax.
 */
export async function taxReport(db: Db, shopId: string, range: { from: Date; to: Date }) {
  const o = schema.orders;
  const orders = await db
    .select({ id: o.id, total: o.totalMinor, tax: o.taxMinor, breakdown: o.taxBreakdown, refunded: o.refundedMinor })
    .from(o)
    .where(and(eq(o.shopId, shopId), inArray(o.paymentStatus, ["paid", "partially_refunded", "refunded"]), gte(o.paidAt, range.from), lte(o.paidAt, range.to), sql`${o.taxMinor} > 0`));
  const refunds = orders.length
    ? await db
        .select({ orderId: schema.refunds.orderId, tax: sql<number>`sum(${schema.refunds.taxRefundedMinor})::int` })
        .from(schema.refunds)
        .where(inArray(schema.refunds.orderId, orders.map((x) => x.id)))
        .groupBy(schema.refunds.orderId)
    : [];
  const byPlace = new Map<string, { jurisdiction: string; label: string; orders: number; salesMinor: number; taxMinor: number }>();
  for (const x of orders) {
    const taxBack = Number(refunds.find((r) => r.orderId === x.id)?.tax ?? 0);
    const share = x.tax ? (x.tax - taxBack) / x.tax : 0;
    // The total holds the tax whether prices include it or not, so sales before tax is total minus tax.
    const salesExTax = x.total - x.refunded - (x.tax - taxBack);
    x.breakdown.forEach((line, i) => {
      const row = byPlace.get(line.jurisdiction) ?? { jurisdiction: line.jurisdiction, label: line.label, orders: 0, salesMinor: 0, taxMinor: 0 };
      row.orders++;
      if (i === 0) row.salesMinor += salesExTax; // a sale counts once, under its main place
      row.taxMinor += Math.round(line.amountMinor * share);
      byPlace.set(line.jurisdiction, row);
    });
  }
  return [...byPlace.values()].sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
}
