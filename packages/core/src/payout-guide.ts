// What a merchant needs to get paid, in plain words, before they're sent to Stripe's secure form,
// and the payout rules every store is held to. Nobody can skip the identity check (card networks and
// anti-money-laundering law require it), so the job here is to make it unsurprising: say what to
// have ready, that no company or shop premises are needed, that we never see the numbers, and that
// none of it is needed until the store is ready to take real orders.

import { countryName } from "./shipping";
import { LAUNCH_COUNTRIES, payoutRoute } from "./shops";

export type PayoutGuide = {
  /** What to have ready, one short line each. */
  ready: string[];
  /** The tax number line for this country, or null where individuals aren't usually asked at the start. */
  taxId: string | null;
  /** The kind of bank account payouts go to. */
  bank: string;
  /** For countries paid through cross-border payouts: how that works. */
  crossBorder: string | null;
};

const EU_IBAN = "A bank account in your name with an IBAN in the country your store is based in";

/** The guide for a store's country (its ISO code). */
export function payoutGuide(country: string): PayoutGuide {
  const ready = [
    "Your legal name, date of birth and phone number",
    "Your home address. No shop, office or warehouse is needed",
    "A photo ID (passport, driving licence or national ID card), only if Stripe can't confirm you from your details",
  ];
  if (country === "US") {
    return {
      ready,
      taxId:
        "The last 4 digits of your Social Security number to start. Stripe asks for the full number only once your sales grow, because US tax law needs it for the yearly 1099-K form. Rather not use your SSN? Get a free EIN from the IRS (irs.gov, about 10 minutes online, no company needed) and use that instead.",
      bank: "A US bank account in your name (routing and account number)",
      crossBorder: null,
    };
  }
  if (country === "CA") {
    return {
      ready,
      taxId: "Stripe may ask for your Social Insurance Number or business number once your sales grow.",
      bank: "A Canadian bank account in your name (transit, institution and account number)",
      crossBorder: null,
    };
  }
  if (country === "GB") {
    return { ready, taxId: null, bank: "A UK bank account in your name (sort code and account number)", crossBorder: null };
  }
  const taxId = "Some countries ask for a tax number once your sales grow; Stripe tells you if yours does.";
  if ((LAUNCH_COUNTRIES as readonly string[]).includes(country)) return { ready, taxId, bank: EU_IBAN, crossBorder: null };
  const name = countryName(country);
  const bank = `A bank account in your name in ${name}. Stripe pays out in your local currency`;
  if (payoutRoute(country) === "own_account") return { ready, taxId, bank, crossBorder: null };
  return {
    ready,
    taxId,
    bank,
    crossBorder: `Stripe doesn't open full accounts in ${name} yet, so buyers pay through us and Stripe sends your money straight to your bank (cross-border payouts). Your store sells in US dollars, and payouts can take a few days longer.`,
  };
}

/** Lines shown with every guide: why we ask, and who sees what. */
export const PAYOUT_GUIDE_NOTES = [
  "You don't need a company. Selling as yourself is fine, and you can switch to a company later.",
  "You type these details on Stripe's own secure page. We never see or store your ID or tax numbers.",
  "Card networks and the law require every seller to be checked before money is paid out, on every platform. It takes about five minutes on your phone.",
  "You can build your whole store first. Set this up when you're ready to take your first real order.",
] as const;

/** The payout rules, shown publicly at /payout-rules and linked from signup and the Money page. */
export const PAYOUT_RULES: { heading: string; points: string[] }[] = [
  {
    heading: "When your money arrives",
    points: [
      "Buyers pay by card through Stripe, and the money goes to your own payout account, then to your bank automatically.",
      "Your first payout usually takes 7 to 14 days while Stripe sets up your account. After that, money usually reaches your bank 2 to 4 working days after each sale, depending on your country.",
      "The Money page always shows what's available, what's still clearing, what's on the way and what's been paid.",
    ],
  },
  {
    heading: "What can pause payouts",
    points: [
      "Details missing from your payout setup, or an ID that couldn't be checked.",
      "Sales jumping much faster than usual, until you show you can deliver (a supplier invoice is usually enough).",
      "Too many buyers disputing payments with their bank. Above 0.75% of orders, card processors start to hold money; we warn you before you get there.",
      "Refunding a large share of orders, or shipping late on many of them.",
      "Selling something our Acceptable Use Policy doesn't allow.",
    ],
  },
  {
    heading: "What we promise",
    points: [
      "Every pause shows on your Money page and in the app: why, what to send and by when. You can send documents from your phone.",
      "Your money stays yours. Sales keep coming in during a pause and are paid out as soon as it's cleared.",
      "Your store is never paused without a warning, a reason and a date first. The only exceptions are illegal products and failed identity checks.",
      "You can appeal any decision to a person.",
    ],
  },
  {
    heading: "How to never see a pause",
    points: [
      "Finish payout setup before your first real order.",
      "Ship on time and add tracking to every order.",
      "Answer buyers quickly and keep a clear returns page.",
      "Keep supplier invoices for your orders, in case you're asked.",
    ],
  },
];
