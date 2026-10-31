// Store policies. Buyers, banks deciding a chargeback and ad platforms all look for a returns,
// shipping, privacy and terms page before they trust a store. Writing them is a chore, so the
// store drafts them from its own settings (return window, shipping zones and times, pickup,
// cancelling, ad tracking) and adds them as ordinary pages the merchant can edit. The
// accessibility statement is what the European Accessibility Act asks EU stores to publish. A page that
// already exists at the same address is never replaced. They're a starting point, not legal advice.
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";
import { holidayReturnsDates } from "./holiday-returns";
import { formatMoney } from "./money";
import { createPage } from "./pages";
import { countryName, listShippingZones } from "./shipping";

type Shop = typeof schema.shops.$inferSelect;

export const POLICY_KINDS = ["returns", "shipping", "privacy", "terms", "accessibility"] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

export const POLICY_TITLES: Record<PolicyKind, string> = {
  returns: "Returns and refunds",
  shipping: "Shipping",
  privacy: "Privacy policy",
  terms: "Terms of service",
  accessibility: "Accessibility statement",
};

const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

function days(min: number | null, max: number | null) {
  if (min && max && min !== max) return `${min} to ${max} business days`;
  const d = max ?? min;
  return d ? `${d} business ${d === 1 ? "day" : "days"}` : null;
}

const longDay = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function holidayLine(shop: Shop) {
  const h = holidayReturnsDates(shop);
  return h ? [`Holiday orders get longer returns: orders placed from ${longDay.format(h.from)} to ${longDay.format(h.to)} can be returned until ${longDay.format(h.until)}.`] : [];
}

function returnsPolicy(shop: Shop) {
  const parts = [`We want you to be happy with your order from ${shop.name}.`];
  if (shop.returnWindowDays > 0) {
    parts.push(
      `You can ask for a return within ${shop.returnWindowDays} days of delivery. Open your order page (the link is in your order email) and choose "Return something", or write to us through our contact page. Tell us what you're sending back and why.`,
      ...holidayLine(shop),
      shop.returnInstructions?.trim() || "Items should be unused and in their original packaging. We'll tell you where to send them once we've approved the return.",
      "Once the items reach us and we've checked them, we refund the price to the card you paid with. Banks usually take 5 to 10 business days to show it. Shipping costs aren't refunded unless the item arrived damaged or wasn't what you ordered.",
    );
  } else {
    parts.push("We don't take returns on change of mind. If something arrives damaged, broken or isn't what you ordered, write to us through our contact page within 14 days of delivery with a photo, and we'll send a replacement or refund you.");
  }
  parts.push("If your order arrives damaged or wrong, write to us with a photo and we'll put it right at no cost to you.");
  if (shop.buyerCancel) parts.push("Changed your mind before it ships? You can cancel from your order page in the first hours after paying, for a full refund.");
  parts.push("Gift cards and personalised items can't be returned unless they arrive faulty.");
  return parts.join("\n\n");
}

async function shippingPolicy(db: Db, shop: Shop) {
  const { zones, isDefault } = await listShippingZones(db, shop.id);
  const money = (m: number) => formatMoney(m, shop.currency);
  const parts = [`We prepare orders within ${shop.processingDays} business ${shop.processingDays === 1 ? "day" : "days"} of payment, then send you an email with tracking as soon as it's on its way.`];
  const lines: string[] = [];
  for (const z of zones) {
    const where = isDefault ? "Everywhere we ship" : list(z.countries.map(countryName));
    for (const r of z.rates) {
      const cost = r.priceMinor ? money(r.priceMinor) : "free";
      const free = r.freeOverMinor ? `, free on orders over ${money(r.freeOverMinor)}` : "";
      const time = days(r.minDays, r.maxDays);
      lines.push(`${where}: ${r.name}, ${cost}${free}${time ? `, usually ${time}` : ""}.`);
    }
  }
  if (lines.length) parts.push(`Where we ship and what it costs:\n${lines.join("\n")}`);
  parts.push("Delivery times start when your order ships and can run longer around holidays or at customs.");
  if (shop.localPickup) parts.push(`You can also pick up your order for free from ${shop.localPickup.address.split("\n")[0]}. Choose "Pick up" at checkout and we'll email you when it's ready.`);
  if (shop.localDeliveryArea) parts.push("Near us? At checkout, enter your postal code to see whether we can deliver it ourselves.");
  parts.push("Orders going to another country may have import duties or taxes charged by your country's customs. These are paid by the buyer when the parcel arrives.");
  parts.push("If your tracking hasn't moved for a while or your parcel arrived damaged, write to us through our contact page and we'll sort it out.");
  return parts.join("\n\n");
}

function privacyPolicy(shop: Shop) {
  const pixels = shop.adPixels && (shop.adPixels.meta || shop.adPixels.tiktok || shop.adPixels.google || shop.adPixels.pinterest);
  const parts = [
    `This page explains what ${shop.name} collects about you and why.`,
    "What we collect: your name, email, delivery address and phone number (if you give one) when you order, what you bought, and messages you send us. Card details go straight to our payment provider; we never see or store your card number.",
    "Why: to deliver your order, send you emails about it, answer your questions, prevent fraud and keep the records the law asks of us.",
    "Who we share it with: the companies that make and ship your order (only what they need to deliver it), our payment provider, and the platform this store runs on.",
    "Marketing emails: we only send news and offers if you ticked the box or signed up, and every email has a link to unsubscribe.",
  ];
  if (pixels) parts.push("Cookies and ads: we use advertising tags to measure our ads. You can choose whether they load in the cookie settings at the bottom of every page.");
  parts.push("Your choices: you can ask to see, correct or delete what we hold about you by writing to us through our contact page. We keep order records as long as tax law requires.");
  return parts.join("\n\n");
}

function termsPolicy(shop: Shop) {
  const seller = shop.invoiceLegalName?.trim() || shop.name;
  return [
    `These terms apply when you buy from ${shop.name}, run by ${seller}${shop.country ? ` in ${countryName(shop.country)}` : ""}.`,
    `Prices are shown in ${shop.currency} unless you pick another currency, and include or add tax as shown at checkout. We may change prices at any time, but not on an order you've already paid for.`,
    "An order is accepted once you've paid and we've emailed you. If we can't fulfil it, for example because an item sold out, we'll tell you and refund you in full.",
    "Delivery, returns and refunds work as described on our Shipping and Returns pages.",
    "Product photos and descriptions are as accurate as we can make them, but colours can look different on screens.",
    "Nothing in these terms takes away rights you have under the consumer laws where you live.",
    "Questions? Write to us through our contact page.",
  ].join("\n\n");
}

function accessibilityPolicy(shop: Shop, now: Date) {
  return [
    `${shop.name} wants everyone to be able to shop here, including people who use a screen reader, a keyboard instead of a mouse, zoom or voice control.`,
    "Our aim: this store aims to meet the Web Content Accessibility Guidelines (WCAG) 2.1 at level AA, the standard behind the European Accessibility Act (EN 301 549).",
    "How it's checked: the pages you shop on, from the home page to checkout, are tested automatically against WCAG 2.1 AA each time the software behind this store changes. They work with a keyboard, have headings and labels for screen readers, and keep enough contrast between text and background.",
    "What may not be fully accessible yet: some product photos may not have a written description, and videos from YouTube or Vimeo may not have captions. Ask us and we'll describe a product for you.",
    "Need help? If anything on this store is hard to use, write to us through our contact page. Tell us which page and what you were trying to do, and we'll help you place your order another way.",
    `This statement was written on ${longDay.format(now)}.`,
  ].join("\n\n");
}

/** The policy pages this store would get, with any that already exist at the same address. */
export async function draftPolicies(db: Db, shop: Shop, now = new Date()) {
  const existing = await db.query.pages.findMany({
    where: and(eq(schema.pages.shopId, shop.id), inArray(schema.pages.handle, [...POLICY_KINDS])),
    columns: { id: true, handle: true },
  });
  const bodies: Record<PolicyKind, string> = {
    returns: returnsPolicy(shop),
    shipping: await shippingPolicy(db, shop),
    privacy: privacyPolicy(shop),
    terms: termsPolicy(shop),
    accessibility: accessibilityPolicy(shop, now),
  };
  return POLICY_KINDS.map((kind) => ({ kind, title: POLICY_TITLES[kind], handle: kind, body: bodies[kind], existingId: existing.find((p) => p.handle === kind)?.id ?? null }));
}

/** Adds the chosen policies as published pages, skipping any that already exist. */
export async function addPolicyPages(db: Db, shop: Shop, kinds: string[]) {
  const wanted = POLICY_KINDS.filter((k) => kinds.includes(k));
  if (!wanted.length) throw new UserError("Pick at least one policy to add.");
  const drafts = await draftPolicies(db, shop);
  const created = [];
  for (const d of drafts) {
    if (!wanted.includes(d.kind) || d.existingId) continue;
    created.push(await createPage(db, shop.id, { title: d.title, handle: d.handle, body: d.body, published: true }));
  }
  return created;
}
