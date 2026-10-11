import type { Address } from "@sf/db";

export type SupplierName = "fake" | "cj" | "aliexpress";

export type SupplierProduct = {
  ref: string;
  sourceUrl: string;
  title: string;
  /** Plain text. Supplier HTML is stripped before it reaches us. */
  description: string;
  images: string[];
  variants: {
    ref: string;
    title: string;
    /** Named options like { Color: "Black", Size: "XL" }, when the supplier gives them. */
    options?: Record<string, string>;
    /** The supplier's photo of this variant (the red one, say), when it has one. */
    imageUrl?: string | null;
    costMinor: number;
    stock: number | null;
    shipDaysMin: number | null;
    shipDaysMax: number | null;
  }[];
};

export type PlaceOrderInput = {
  /** Our fulfillment id. Suppliers that support it use this to reject duplicates. */
  reference: string;
  email: string;
  address: Address;
  /** `note` is the buyer's personalisation for that item, like "Name to engrave: Ada". */
  lines: { variantRef: string; quantity: number; note?: string }[];
};

export type Tracking = {
  status: "in_transit" | "delivered";
  carrier: string;
  trackingNumber: string;
  url: string;
};

export interface SupplierAdapter {
  readonly name: SupplierName;
  /** Shown to merchants. */
  readonly label: string;
  matchesUrl(url: URL): boolean;
  getProductFromUrl(url: string): Promise<SupplierProduct>;
  placeOrder(input: PlaceOrderInput): Promise<{ supplierOrderRef: string }>;
  /** null until the supplier has handed the parcel to a carrier. */
  getTracking(supplierOrderRef: string): Promise<Tracking | null>;
  /** Cancel an order that hasn't shipped. `cancelled: false` with a reason when the supplier says no. */
  cancelOrder(supplierOrderRef: string): Promise<{ cancelled: boolean; message: string | null }>;
}

export type ProblemCode =
  | "out_of_stock"
  | "address_unsupported"
  | "insufficient_balance"
  | "product_unavailable"
  | "supplier_unreachable"
  | "not_connected"
  | "late_shipment"
  | "unknown";

/** A supplier refused or failed a request. `retryable` means trying again later may work as is. */
export class SupplierError extends Error {
  constructor(
    readonly code: ProblemCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "SupplierError";
  }
}

/** Turn supplier HTML into plain text for a product description. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}
