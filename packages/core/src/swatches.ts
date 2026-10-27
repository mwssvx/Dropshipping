// Colour swatches: the values of a product's colour option shown as dots of that colour on the
// store, not just words. Common colour names work on their own ("Navy", "Olive green"); for names
// that don't say ("Sage", "Midnight", "Sunset") the merchant picks the colour once per value.
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

/** Option names that mean colour, in the store languages. */
const COLOR_OPTION = /^(colou?rs?|farbe|couleur|kleur|colore|cor)$/i;

const NAMED: Record<string, string> = {
  black: "#111111", white: "#ffffff", ivory: "#fffff0", cream: "#f5f0dc", beige: "#e8dcc4", sand: "#d8c8a8", khaki: "#c3b091",
  tan: "#d2b48c", camel: "#c19a6b", brown: "#7b4a2a", chocolate: "#5a3420", coffee: "#6f4e37", mocha: "#7a5c4a", taupe: "#8b7d6b",
  grey: "#8a8a8a", gray: "#8a8a8a", charcoal: "#36454f", silver: "#c0c0c0", "light grey": "#cfcfcf", "light gray": "#cfcfcf",
  "dark grey": "#555555", "dark gray": "#555555", red: "#d22b2b", burgundy: "#800020", maroon: "#7a1f2b", wine: "#722f37",
  coral: "#ff7f50", orange: "#f28c28", rust: "#b7410e", terracotta: "#c8643b", peach: "#ffcba4", yellow: "#f5d020",
  mustard: "#d4a017", gold: "#d4af37", green: "#2e8b57", olive: "#708238", mint: "#98d8b0",
  sage: "#9caf88", emerald: "#1f8a5b", forest: "#228b22", teal: "#008080", turquoise: "#30d5c8", aqua: "#5fd3e0",
  blue: "#2f6fd6", navy: "#1f2a4d", "navy blue": "#1f2a4d", "sky blue": "#87ceeb", "light blue": "#9cc7f0", "royal blue": "#4169e1",
  denim: "#4f6d8f", indigo: "#4b0082", purple: "#7b3fa0", lavender: "#b8a2d8", lilac: "#c8a2c8", violet: "#8f5bd6",
  plum: "#6e3a5e", pink: "#f4a6c1", "hot pink": "#ff4fa0", rose: "#e8a0a8", blush: "#f2c4c4", fuchsia: "#d4398f",
  magenta: "#c2185b", nude: "#e3bc9a", natural: "#e9dfcb", clear: "#f2f6f8", transparent: "#f2f6f8",
  // The same few in the other store languages.
  schwarz: "#111111", weiß: "#ffffff", weiss: "#ffffff", rot: "#d22b2b", blau: "#2f6fd6", grün: "#2e8b57", gelb: "#f5d020", grau: "#8a8a8a", braun: "#7b4a2a", rosa: "#f4a6c1",
  noir: "#111111", blanc: "#ffffff", rouge: "#d22b2b", bleu: "#2f6fd6", vert: "#2e8b57", jaune: "#f5d020", gris: "#8a8a8a", marron: "#7b4a2a",
  negro: "#111111", blanco: "#ffffff", rojo: "#d22b2b", azul: "#2f6fd6", verde: "#2e8b57", amarillo: "#f5d020", morado: "#7b3fa0",
  nero: "#111111", bianco: "#ffffff", rosso: "#d22b2b", blu: "#2f6fd6", giallo: "#f5d020", grigio: "#8a8a8a",
  zwart: "#111111", wit: "#ffffff", rood: "#d22b2b", blauw: "#2f6fd6", groen: "#2e8b57", geel: "#f5d020", grijs: "#8a8a8a",
};

const HEX = /^#[0-9a-f]{6}$/;

/** The product's colour option (Color, Colour, Farbe…), or null when it has none. */
export function colorOption(variants: { options: Record<string, string> | null }[]) {
  const names = [...new Set(variants.flatMap((v) => Object.keys(v.options ?? {})))];
  return names.find((n) => COLOR_OPTION.test(n.trim())) ?? null;
}

/** The colour a value's name says on its own: the whole name, else its last colour word ("Dusty Rose"). */
export function namedColor(value: string): string | null {
  const name = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (NAMED[name]) return NAMED[name]!;
  const words = name.split(/[\s/&,-]+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const two = i > 0 ? `${words[i - 1]} ${words[i]}` : null;
    if (two && NAMED[two]) return NAMED[two]!;
    if (NAMED[words[i]!]) return NAMED[words[i]!]!;
  }
  return null;
}

/**
 * Each value of the product's colour option with the colour it shows as: the merchant's pick,
 * else the colour its name says, else null (shown as words only). Null when there's no colour option.
 */
export function productSwatches(product: { swatches: Record<string, string> | null; variants: { options: Record<string, string> | null }[] }) {
  const option = colorOption(product.variants);
  if (!option) return null;
  const values = [...new Set(product.variants.map((v) => v.options?.[option]).filter((x): x is string => !!x))];
  return {
    option,
    values: values.map((value) => {
      const picked = product.swatches?.[value] ?? null;
      const named = namedColor(value);
      return { value, color: picked ?? named, named, picked: !!picked };
    }),
  };
}

/**
 * Saves the colour for some values of a product's colour option. A colour the name already says,
 * or an empty one, goes back to following the name. Values the product doesn't have are refused.
 */
export async function setSwatches(db: Db, shopId: string, productId: string, colors: Record<string, string>) {
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)),
    columns: { id: true, swatches: true },
  });
  if (!product) throw new NotFoundError("Product");
  const variants = await db.query.variants.findMany({ where: eq(schema.variants.productId, product.id), columns: { options: true } });
  const current = productSwatches({ swatches: product.swatches, variants });
  if (!current) throw new UserError("Add a colour option to this product first.");
  const next: Record<string, string> = {};
  for (const [value, raw] of Object.entries(colors)) {
    const known = current.values.find((v) => v.value === value);
    if (!known) throw new UserError(`${value} isn't one of this product's colours.`);
    const color = raw.trim().toLowerCase();
    if (!color || color === known.named) continue;
    if (!HEX.test(color)) throw new UserError(`Pick a colour for ${value}.`);
    next[value] = color;
  }
  // Colours not sent keep what they had, as long as the product still has them.
  for (const v of current.values) if (!(v.value in colors) && product.swatches[v.value]) next[v.value] = product.swatches[v.value]!;
  await db.update(schema.products).set({ swatches: next, updatedAt: new Date() }).where(eq(schema.products.id, product.id));
  return productSwatches({ swatches: next, variants })!;
}
