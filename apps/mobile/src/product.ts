export type Product = {
  id: string;
  title: string;
  status: "draft" | "active" | "archived";
  imageUrl: string | null;
  descriptionHtml: string;
  aiGenerated: boolean;
  sourceUrl: string | null;
  variants: { id: string; title: string; priceMinor: number; costMinor: number | null; stock: number | null; weightGrams: number | null }[];
  /** Goes in a parcel, so it can have a weight. */
  ships: boolean;
  /** The store's own stock: the merchant sets what it costs. */
  ownStock: boolean;
  /** What it still lacks. */
  missing: ("photo" | "description" | "weight" | "customs" | "cost")[];
  hsCode: string | null;
  originCountry: string | null;
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
