import { z } from "zod";
import { UserError } from "./errors";

/*
 * A store's look is one JSON document: style settings, two menus and an ordered list of
 * home page sections. The editor saves it as a draft; publishing makes it what buyers see.
 * Every section type is rendered by the storefront's section library (apps/web/src/theme).
 *
 * This file has no database or Node imports so the editor can use it in the browser.
 */

export const THEME_FONTS = {
  system: { label: "System", family: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', google: null },
  inter: { label: "Inter", family: '"Inter", sans-serif', google: "Inter:wght@400;600;700" },
  "dm-sans": { label: "DM Sans", family: '"DM Sans", sans-serif', google: "DM+Sans:wght@400;600;700" },
  "work-sans": { label: "Work Sans", family: '"Work Sans", sans-serif', google: "Work+Sans:wght@400;600;700" },
  "space-grotesk": { label: "Space Grotesk", family: '"Space Grotesk", sans-serif', google: "Space+Grotesk:wght@400;600;700" },
  fraunces: { label: "Fraunces", family: '"Fraunces", serif', google: "Fraunces:wght@400;600;700" },
  playfair: { label: "Playfair Display", family: '"Playfair Display", serif', google: "Playfair+Display:wght@400;600;700" },
} as const;
export type ThemeFont = keyof typeof THEME_FONTS;
const fontKeys = Object.keys(THEME_FONTS) as [ThemeFont, ...ThemeFont[]];

const hex = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Colors must look like #1a2b3c.");
const text = (max: number) => z.string().max(max, `Keep text under ${max} characters.`).default("");
const imageUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => u === "" || /^https:\/\/[^\s]+$/.test(u), "Images must be an https web address.")
  .default("");

/** Store links are a path inside the store (/collections/all), a full https link, or mailto. */
export function isSafeLink(href: string) {
  if (href === "") return true;
  if (href.startsWith("/")) return !href.startsWith("//") && !/\s/.test(href);
  return /^(https?:\/\/|mailto:)[^\s]+$/i.test(href);
}
const link = z.string().trim().max(500).refine(isSafeLink, "Links must start with /, https:// or mailto:.").default("");

/** Icons a trust badge can show. Drawn by the storefront's section library. */
export const TRUST_ICONS = ["shipping", "returns", "secure", "support", "quality", "eco"] as const;
export type TrustIcon = (typeof TRUST_ICONS)[number];

/** What a featured products grid shows from its collection: its own order, or a pick from it. */
export const FEATURED_SHOWS = ["listed", "best_selling", "newest", "on_sale"] as const;
export type FeaturedShow = (typeof FEATURED_SHOWS)[number];

type Pickable = { id: string; priceMinor: number; compareAtMinor: number | null; soldOut?: boolean; sold?: number; createdAt?: Date | string };

/**
 * The products a featured grid shows, before the limit. Best sellers and newest keep the
 * collection's order for ties; any pick puts sold out products after the rest.
 */
export function pickFeatured<T extends Pickable>(list: T[], show: FeaturedShow): T[] {
  if (show === "listed") return list;
  const at = (p: T) => (p.createdAt ? new Date(p.createdAt).getTime() : 0);
  const pool = show === "on_sale" ? list.filter((p) => p.compareAtMinor !== null && p.compareAtMinor > p.priceMinor) : list;
  const order = new Map(pool.map((p, i) => [p.id, i]));
  return [...pool].sort(
    (a, b) =>
      Number(!!a.soldOut) - Number(!!b.soldOut) ||
      (show === "best_selling" ? (b.sold ?? 0) - (a.sold ?? 0) : show === "newest" ? at(b) - at(a) : 0) ||
      order.get(a.id)! - order.get(b.id)!,
  );
}

/** Where a featured grid's "View all" goes, so the full list matches the pick. */
export function featuredViewAll(handle: string, show: FeaturedShow) {
  const path = `/collections/${handle}`;
  return show === "best_selling" ? `${path}?sort=best_selling` : show === "newest" ? `${path}?sort=newest` : show === "on_sale" ? `${path}?sale=1` : path;
}

const menuItem = z.object({ label: z.string().trim().min(1, "Every menu item needs a label.").max(40), href: link });

const sectionSchemas = {
  announcement: z.object({ text: text(160), link }),
  hero: z.object({
    heading: text(120),
    text: text(400),
    buttonLabel: text(40),
    buttonLink: link,
    imageUrl,
    height: z.enum(["small", "medium", "large"]).default("medium"),
    align: z.enum(["left", "center"]).default("center"),
  }),
  featured_products: z.object({
    heading: text(120),
    collectionId: z.string().uuid().nullable().default(null),
    limit: z.number().int().min(2).max(12).default(8),
    show: z.enum(FEATURED_SHOWS).default("listed"),
  }),
  collection_list: z.object({ heading: text(120), collectionIds: z.array(z.string().uuid()).max(12).default([]) }),
  image_with_text: z.object({
    heading: text(120),
    text: text(1000),
    imageUrl,
    imagePosition: z.enum(["left", "right"]).default("left"),
    buttonLabel: text(40),
    buttonLink: link,
  }),
  rich_text: z.object({ heading: text(120), text: text(4000) }),
  faq: z.object({
    heading: text(120),
    items: z
      .array(z.object({ question: z.string().trim().min(1, "Every question needs text.").max(200), answer: text(2000) }))
      .max(30)
      .default([]),
  }),
  testimonials: z.object({
    heading: text(120),
    items: z
      .array(z.object({ quote: z.string().trim().min(1, "Every quote needs text.").max(500), name: text(60) }))
      .max(12)
      .default([]),
  }),
  trust_badges: z.object({
    heading: text(120),
    items: z
      .array(z.object({ icon: z.enum(TRUST_ICONS).default("shipping"), title: z.string().trim().min(1, "Every badge needs a title.").max(60), text: text(160) }))
      .max(6)
      .default([]),
  }),
  newsletter: z.object({
    heading: text(120),
    text: text(400),
    buttonLabel: text(40),
  }),
  // Filled from the store's own published reviews, never typed in.
  reviews: z.object({
    heading: text(120),
    limit: z.number().int().min(3).max(12).default(6),
    minRating: z.number().int().min(1).max(5).default(4),
  }),
  // Filled from what each shopper looked at, kept in their own browser.
  recently_viewed: z.object({
    heading: text(120),
    limit: z.number().int().min(2).max(12).default(4),
  }),
} as const;

export type SectionType = keyof typeof sectionSchemas;
export const SECTION_TYPES = Object.keys(sectionSchemas) as SectionType[];

export const SECTION_LABELS: Record<SectionType, { name: string; about: string }> = {
  announcement: { name: "Announcement bar", about: "A thin strip for a short message, like free shipping." },
  hero: { name: "Hero banner", about: "A big heading, a line of text and a button, over an optional image." },
  featured_products: { name: "Featured products", about: "A grid of products from one collection, or from all products." },
  collection_list: { name: "Collection list", about: "Tiles that link to your collections." },
  image_with_text: { name: "Image with text", about: "A picture beside a heading and a paragraph." },
  rich_text: { name: "Text", about: "A heading and a few paragraphs." },
  faq: { name: "Questions and answers", about: "A list of questions buyers can open." },
  testimonials: { name: "Customer quotes", about: "Short quotes from happy buyers. Use real ones only." },
  trust_badges: { name: "Trust badges", about: "Small icons with promises like free returns or secure checkout." },
  newsletter: { name: "Email signup", about: "Buyers leave their email to hear about news and offers. They confirm it by email first." },
  reviews: { name: "Buyer reviews", about: "The latest real reviews from your buyers, with their stars and your store's average. It fills itself as reviews come in." },
  recently_viewed: { name: "Recently viewed", about: "The products each shopper looked at last, so they can find them again. Shoppers who haven't looked at any yet don't see it." },
};

const sectionId = z.string().regex(/^[a-z0-9]{4,24}$/, "Section ids are short lowercase codes.");
const sectionOf = (type: SectionType) =>
  z.object({ id: sectionId, type: z.literal(type), hidden: z.boolean().default(false), settings: sectionSchemas[type] as z.ZodType<Record<string, unknown>> });
const section = z.discriminatedUnion("type", SECTION_TYPES.map(sectionOf) as [ReturnType<typeof sectionOf>, ...ReturnType<typeof sectionOf>[]]);

const themeDoc = z.object({
  version: z.literal(1).default(1),
  settings: z.object({
    colors: z.object({ background: hex, text: hex, accent: hex, accentText: hex }),
    headingFont: z.enum(fontKeys).default("system"),
    bodyFont: z.enum(fontKeys).default("system"),
    corners: z.enum(["square", "soft", "round"]).default("soft"),
    // How the store is laid out. Stores saved before layouts existed get the defaults.
    layout: z
      .object({
        header: z.enum(["classic", "centered", "minimal"]).default("classic"),
        productImage: z.enum(["square", "portrait", "landscape"]).default("square"),
        columns: z.union([z.literal(3), z.literal(4)]).default(4),
        cards: z.enum(["plain", "framed"]).default("plain"),
        buttons: z.enum(["filled", "outline"]).default("filled"),
      })
      .prefault({}),
    logoText: text(60),
    logoUrl: imageUrl,
    seo: z.object({ title: text(70), description: text(320) }).prefault({}),
  }),
  menus: z.object({ header: z.array(menuItem).max(12).default([]), footer: z.array(menuItem).max(20).default([]) }),
  home: z.array(section).max(30),
});

export type SectionSettings = { [K in SectionType]: z.infer<(typeof sectionSchemas)[K]> };
export type Section = { [K in SectionType]: { id: string; type: K; hidden: boolean; settings: SectionSettings[K] } }[SectionType];
export type ThemeDoc = Omit<z.infer<typeof themeDoc>, "home"> & { home: Section[] };
export type MenuItem = z.infer<typeof menuItem>;

/** Validates a theme document from the editor. Errors are safe to show to the merchant. */
export function parseTheme(input: unknown): ThemeDoc {
  const parsed = themeDoc.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new UserError(issue.message === "Required" ? `Missing a value at ${issue.path.join(".")}.` : issue.message);
  }
  const ids = new Set<string>();
  for (const s of parsed.data.home) {
    if (ids.has(s.id)) throw new UserError("Two sections share an id.");
    ids.add(s.id);
  }
  return parsed.data as ThemeDoc;
}

export function sectionDefaults<T extends SectionType>(type: T): SectionSettings[T] {
  return sectionSchemas[type].parse({}) as SectionSettings[T];
}

export function newSectionId() {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

type Look = Pick<ThemeDoc["settings"], "colors" | "headingFont" | "bodyFont" | "corners" | "layout">;
type StarterSection = { id: string; type: SectionType; hidden?: boolean; settings: Record<string, unknown> };

const FAQ_STARTER: StarterSection = {
  id: "faq00001",
  type: "faq",
  settings: {
    heading: "Good to know",
    items: [
      { question: "How long does delivery take?", answer: "Each product page shows an honest delivery estimate before you buy." },
      { question: "Can I return an item?", answer: "Yes. Contact us within 30 days of delivery and we'll sort it out." },
    ],
  },
};
const BADGES_STARTER: StarterSection = {
  id: "badges01",
  type: "trust_badges",
  settings: {
    heading: "",
    items: [
      { icon: "shipping", title: "Tracked delivery", text: "Every order comes with a tracking number." },
      { icon: "returns", title: "30-day returns", text: "Not right? Send it back within 30 days." },
      { icon: "secure", title: "Secure checkout", text: "Card details never touch our servers." },
    ],
  },
};
const QUOTES_STARTER: StarterSection = {
  id: "quotes01",
  type: "testimonials",
  hidden: true,
  settings: { heading: "What buyers say", items: [{ quote: "Replace this with a real quote from one of your buyers.", name: "A happy buyer" }] },
};
const NEWSLETTER_STARTER: StarterSection = {
  id: "signup01",
  type: "newsletter",
  settings: { heading: "Hear about new arrivals first", text: "News and offers now and then. Unsubscribe any time.", buttonLabel: "Sign up" },
};
const announce = (shown: boolean): StarterSection => ({ id: "announce1", type: "announcement", hidden: !shown, settings: { text: "Free shipping on orders over $50" } });
const featured = (heading: string, limit = 8): StarterSection => ({ id: "featured1", type: "featured_products", settings: { heading, limit } });
const hero = (shopName: string, s: Record<string, unknown> = {}): StarterSection => ({
  id: "hero0001",
  type: "hero",
  settings: { heading: `Welcome to ${shopName}`.slice(0, 120), text: "Things we love, shipped to your door.", buttonLabel: "Shop now", buttonLink: "/collections/all", ...s },
});

/**
 * Ready-made themes: a look (colors, fonts, corners), a layout, and a starter home page. Applying
 * one keeps the merchant's logo, menus and search settings, and their sections unless they ask.
 */
export const THEME_PRESETS = {
  clean: {
    label: "Clean",
    about: "White and green, classic header. Fits almost anything.",
    look: {
      colors: { background: "#ffffff", text: "#151a23", accent: "#0f6b5c", accentText: "#ffffff" },
      headingFont: "inter", bodyFont: "inter", corners: "soft",
      layout: { header: "classic", productImage: "square", columns: 4, cards: "plain", buttons: "filled" },
    },
    home: (shopName: string): StarterSection[] => [announce(false), hero(shopName), featured("Featured products"), FAQ_STARTER],
  },
  bold: {
    label: "Bold",
    about: "Dark with a bright accent and big type. Gadgets and streetwear.",
    look: {
      colors: { background: "#0e0e10", text: "#f4f4f5", accent: "#facc15", accentText: "#0e0e10" },
      headingFont: "space-grotesk", bodyFont: "dm-sans", corners: "square",
      layout: { header: "minimal", productImage: "square", columns: 4, cards: "plain", buttons: "filled" },
    },
    home: (shopName: string): StarterSection[] => [
      announce(true), hero(shopName, { height: "large", align: "left", text: "New drops every week." }), featured("Best sellers"), BADGES_STARTER, QUOTES_STARTER,
    ],
  },
  warm: {
    label: "Warm",
    about: "Cream and terracotta, rounded and friendly. Home goods and gifts.",
    look: {
      colors: { background: "#fbf6ef", text: "#2b2118", accent: "#a6461f", accentText: "#ffffff" },
      headingFont: "fraunces", bodyFont: "work-sans", corners: "round",
      layout: { header: "centered", productImage: "portrait", columns: 3, cards: "framed", buttons: "filled" },
    },
    home: (shopName: string): StarterSection[] => [
      hero(shopName),
      { id: "story001", type: "image_with_text", settings: { heading: "Picked with care", text: "Tell buyers who you are and why you chose these products.", buttonLabel: "Our story", buttonLink: "/" } },
      featured("Favorites", 6), QUOTES_STARTER, NEWSLETTER_STARTER,
    ],
  },
  boutique: {
    label: "Boutique",
    about: "Serif headings, centered logo, tall photos. Fashion and beauty.",
    look: {
      colors: { background: "#fffaf7", text: "#1f1a17", accent: "#1f1a17", accentText: "#fffaf7" },
      headingFont: "playfair", bodyFont: "inter", corners: "square",
      layout: { header: "centered", productImage: "portrait", columns: 3, cards: "plain", buttons: "outline" },
    },
    home: (shopName: string): StarterSection[] => [
      announce(true), hero(shopName, { height: "large", text: "The new season is here.", buttonLabel: "Shop new in" }),
      { id: "collect1", type: "collection_list", settings: { heading: "Shop by category" } },
      featured("New in", 6), NEWSLETTER_STARTER,
    ],
  },
  market: {
    label: "Market",
    about: "Bright orange, framed product cards and trust badges up top. Deals and everyday items.",
    look: {
      colors: { background: "#ffffff", text: "#1b1f24", accent: "#c2410c", accentText: "#ffffff" },
      headingFont: "dm-sans", bodyFont: "dm-sans", corners: "soft",
      layout: { header: "classic", productImage: "square", columns: 4, cards: "framed", buttons: "filled" },
    },
    home: (shopName: string): StarterSection[] => [
      announce(true), hero(shopName, { height: "small", align: "left", buttonLabel: "Shop today's deals" }), BADGES_STARTER,
      featured("Today's deals", 12), { id: "collect1", type: "collection_list", settings: { heading: "Browse" } }, FAQ_STARTER,
    ],
  },
  studio: {
    label: "Studio",
    about: "Cool blue, wide photos and rounded cards. Tech and accessories.",
    look: {
      colors: { background: "#f5f7fb", text: "#0b1220", accent: "#1d4ed8", accentText: "#ffffff" },
      headingFont: "space-grotesk", bodyFont: "inter", corners: "round",
      layout: { header: "minimal", productImage: "landscape", columns: 3, cards: "framed", buttons: "filled" },
    },
    home: (shopName: string): StarterSection[] => [
      hero(shopName, { align: "left", text: "Smart gear, tested by us." }), featured("Popular now", 6),
      { id: "story001", type: "image_with_text", settings: { heading: "Why we sell these", text: "Say what makes your products worth buying.", imagePosition: "right" } },
      BADGES_STARTER, FAQ_STARTER,
    ],
  },
  nordic: {
    label: "Nordic",
    about: "Black and white, lots of space, outline buttons. Minimal and calm.",
    look: {
      colors: { background: "#ffffff", text: "#111111", accent: "#111111", accentText: "#ffffff" },
      headingFont: "work-sans", bodyFont: "work-sans", corners: "square",
      layout: { header: "minimal", productImage: "portrait", columns: 4, cards: "plain", buttons: "outline" },
    },
    home: (shopName: string): StarterSection[] => [
      hero(shopName, { height: "small", align: "left", text: "" }), featured("Shop", 8),
      { id: "story002", type: "rich_text", settings: { heading: "About us", text: "A few honest lines about your store." } }, NEWSLETTER_STARTER,
    ],
  },
} as const satisfies Record<string, { label: string; about: string; look: Look; home: (shopName: string) => StarterSection[] }>;
export type ThemePresetId = keyof typeof THEME_PRESETS;
export const THEME_PRESET_IDS = Object.keys(THEME_PRESETS) as ThemePresetId[];

function presetLook(id: ThemePresetId): Look {
  const { look } = THEME_PRESETS[id];
  return { ...look, colors: { ...look.colors }, layout: { ...look.layout } };
}

/** Switch to a ready-made theme. Logo, menus and search settings stay; sections too unless replaced. */
export function applyThemePreset(doc: ThemeDoc, id: ThemePresetId, opts: { replaceSections: boolean; shopName: string }): ThemeDoc {
  return parseTheme({
    ...doc,
    settings: { ...doc.settings, ...presetLook(id) },
    home: opts.replaceSections ? THEME_PRESETS[id].home(opts.shopName) : doc.home,
  });
}

/** Which ready-made theme the store's look matches, if it hasn't been changed since. */
export function currentPreset(doc: ThemeDoc): ThemePresetId | null {
  const pick = ({ colors, headingFont, bodyFont, corners, layout }: Look) => JSON.stringify([colors, headingFont, bodyFont, corners, layout]);
  const mine = pick(doc.settings);
  return THEME_PRESET_IDS.find((id) => pick(presetLook(id)) === mine) ?? null;
}

export function defaultTheme(shopName: string): ThemeDoc {
  return parseTheme({
    settings: presetLook("clean"),
    menus: {
      header: [
        { label: "Home", href: "/" },
        { label: "Shop all", href: "/collections/all" },
      ],
      footer: [],
    },
    home: THEME_PRESETS.clean.home(shopName),
  });
}

/** WCAG contrast ratio between two #rrggbb colors (1 to 21). The editor warns below 4.5. */
export function contrastRatio(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** One Google Fonts stylesheet for the theme's fonts, or null when both are system fonts. */
export function themeFontsHref(settings: Pick<ThemeDoc["settings"], "headingFont" | "bodyFont">) {
  const families = [...new Set([settings.headingFont, settings.bodyFont])]
    .map((f) => THEME_FONTS[f].google)
    .filter((g): g is NonNullable<typeof g> => !!g);
  return families.length ? `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join("&")}&display=swap` : null;
}
