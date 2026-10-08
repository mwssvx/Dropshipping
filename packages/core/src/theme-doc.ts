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
};

const sectionId = z.string().regex(/^[a-z0-9]{4,24}$/, "Section ids are short lowercase codes.");
const section = z.discriminatedUnion(
  "type",
  SECTION_TYPES.map((type) =>
    z.object({ id: sectionId, type: z.literal(type), hidden: z.boolean().default(false), settings: sectionSchemas[type] }),
  ) as unknown as [z.ZodDiscriminatedUnionOption<"type">, ...z.ZodDiscriminatedUnionOption<"type">[]],
);

const themeDoc = z.object({
  version: z.literal(1).default(1),
  settings: z.object({
    colors: z.object({ background: hex, text: hex, accent: hex, accentText: hex }),
    headingFont: z.enum(fontKeys).default("system"),
    bodyFont: z.enum(fontKeys).default("system"),
    corners: z.enum(["square", "soft", "round"]).default("soft"),
    logoText: text(60),
    logoUrl: imageUrl,
    seo: z.object({ title: text(70), description: text(320) }).default({}),
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

/** Ready-made looks the merchant can start from. Only colors, fonts and corners change. */
export const THEME_LOOKS = {
  clean: {
    label: "Clean",
    colors: { background: "#ffffff", text: "#151a23", accent: "#0f6b5c", accentText: "#ffffff" },
    headingFont: "inter",
    bodyFont: "inter",
    corners: "soft",
  },
  bold: {
    label: "Bold",
    colors: { background: "#0e0e10", text: "#f4f4f5", accent: "#facc15", accentText: "#0e0e10" },
    headingFont: "space-grotesk",
    bodyFont: "dm-sans",
    corners: "square",
  },
  warm: {
    label: "Warm",
    colors: { background: "#fbf6ef", text: "#2b2118", accent: "#b4532a", accentText: "#ffffff" },
    headingFont: "fraunces",
    bodyFont: "work-sans",
    corners: "round",
  },
} as const satisfies Record<string, Pick<ThemeDoc["settings"], "colors" | "headingFont" | "bodyFont" | "corners"> & { label: string }>;

export function defaultTheme(shopName: string): ThemeDoc {
  const { label: _, ...look } = THEME_LOOKS.clean;
  return parseTheme({
    settings: { ...look, colors: { ...look.colors } },
    menus: {
      header: [
        { label: "Home", href: "/" },
        { label: "Shop all", href: "/collections/all" },
      ],
      footer: [],
    },
    home: [
      { id: "announce1", type: "announcement", hidden: true, settings: { text: "Free shipping on orders over $50" } },
      {
        id: "hero0001",
        type: "hero",
        settings: {
          heading: `Welcome to ${shopName}`.slice(0, 120),
          text: "Things we love, shipped to your door.",
          buttonLabel: "Shop now",
          buttonLink: "/collections/all",
        },
      },
      { id: "featured1", type: "featured_products", settings: { heading: "Featured products" } },
      {
        id: "faq00001",
        type: "faq",
        settings: {
          heading: "Good to know",
          items: [
            { question: "How long does delivery take?", answer: "Each product page shows an honest delivery estimate before you buy." },
            { question: "Can I return an item?", answer: "Yes. Contact us within 30 days of delivery and we'll sort it out." },
          ],
        },
      },
    ],
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
