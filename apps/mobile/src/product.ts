export type Product = {
  id: string;
  title: string;
  status: "draft" | "active" | "archived";
  imageUrl: string | null;
  /** Every photo in order; the first is the main one. */
  images?: string[];
  imageAlts?: Record<string, string>;
  descriptionHtml: string;
  aiGenerated: boolean;
  sourceUrl: string | null;
  updatedAt?: string;
  handle?: string;
  addressPrefix?: string;
  variants: { id: string; title: string; priceMinor: number; compareAtMinor: number | null; costMinor: number | null; stock: number | null; weightGrams: number | null; sku: string | null; contents?: { amount: number; unit: string } | null }[];
  /** Goes in a parcel, so it can have a weight. */
  ships: boolean;
  /** The store's own stock: the merchant sets what it costs. */
  ownStock: boolean;
  /** What it still lacks. */
  missing: ("photo" | "description" | "weight" | "customs" | "cost")[];
  hsCode: string | null;
  originCountry: string | null;
  shipsFrom?: string | null;
  /** Sold-out options can still be ordered, promised to ship by a date. */
  preorder?: { shipsBy: string; limit: number | null } | null;
  /** On the product screen only: how many were pre-ordered on paid orders. */
  preordersSold?: number;
  /** The least and most a buyer can order. */
  purchaseLimit?: { min: number | null; max: number | null; perCustomer: number | null } | null;
  giftCard?: boolean;
  digital?: boolean;
  processingDays?: number | null;
  shippingSurchargeMinor?: number;
  blockedCountries?: string[];
  blockedCountryNames?: string[];
  minAge?: number | null;
  reorderDays?: number | null;
  videoUrl?: string | null;
  detailsText?: string;
  personalization?: { id: string; label: string; required: boolean; maxLength: number }[];
  badge?: string | null;
  publishAt?: string | null;
  comingSoon?: boolean;
  quantityBreaks?: { minQty: number; percentOff: number }[];
  swatches?: { option: string; values: { value: string; color: string | null; named: string | null; picked: boolean }[] } | null;
  /** Lowercase, for filters, collections that fill by tag, and codes for tagged products. */
  tags?: string[];
  /** On the product screen only: the tags the store's products use, most used first. */
  storeTags?: string[];
  maxTags?: number;
  /** The store's collections, and whether this product is in each. */
  collections?: { id: string; title: string; auto: boolean; in: boolean }[];
  /** A second supplier's listing, for when the main one runs out; only for imported products. */
  backup?: {
    possible: boolean;
    link: { sourceUrl: string; gone: boolean; checkedAt: string; options: { title: string; costMinor: number | null; stock: number | null; covered: boolean }[] } | null;
  };
  /** On the list only: sold out, or an option at or under the store's running-low number. */
  stockLevel?: "sold_out" | "low" | null;
};

export const MISSING: Record<Product["missing"][number], string> = {
  photo: "No photo",
  description: "No description",
  weight: "No weight",
  customs: "No customs details",
  cost: "No cost",
};

export const STATUS: Record<Product["status"], { label: string; tone: "success" | "neutral" | "warning" }> = {
  active: { label: "On sale", tone: "success" },
  draft: { label: "Draft", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" },
};

/** Whether a product matches what was typed in the search box: its title, an option's name or a SKU. */
export function matches(p: Product, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.title, ...p.variants.flatMap((v) => [v.title, v.sku ?? ""])].some((t) => t.toLowerCase().includes(q));
}
