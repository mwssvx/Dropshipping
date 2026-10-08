import { SupplierError, type PlaceOrderInput, type SupplierAdapter, type SupplierProduct, type Tracking } from "./types";

/**
 * A stand-in supplier so the whole dropshipping flow runs without a supplier account.
 * Links look like https://demo-supplier.test/p/<slug>. Products are made up from the slug:
 * a slug containing "low-stock" sells out by the time an order is placed, and orders to countries
 * outside the launch list fail.
 */
export const DEMO_SUPPLIER_HOST = "demo-supplier.test";
export const DEMO_SUPPLIER_LINKS = [
  `https://${DEMO_SUPPLIER_HOST}/p/sunset-projection-lamp`,
  `https://${DEMO_SUPPLIER_HOST}/p/magnetic-phone-stand`,
  `https://${DEMO_SUPPLIER_HOST}/p/galaxy-projector-low-stock`,
];
const SHIPS_TO = new Set(
  "US GB CA AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" "),
);

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export type FakeSupplierOptions = {
  /** How long after an order is placed it ships and is delivered. */
  shipAfterMs?: number;
  deliverAfterMs?: number;
  now?: () => number;
};

export class FakeSupplier implements SupplierAdapter {
  readonly name = "fake" as const;
  readonly label = "Demo supplier";
  private readonly shipAfterMs: number;
  private readonly deliverAfterMs: number;
  private readonly now: () => number;

  constructor(opts: FakeSupplierOptions = {}) {
    this.shipAfterMs = opts.shipAfterMs ?? 0;
    this.deliverAfterMs = opts.deliverAfterMs ?? 3 * 24 * 3600_000;
    this.now = opts.now ?? Date.now;
  }

  matchesUrl(url: URL) {
    return url.hostname === DEMO_SUPPLIER_HOST;
  }

  async getProductFromUrl(raw: string): Promise<SupplierProduct> {
    const url = new URL(raw);
    const slug = url.pathname.match(/^\/p\/([a-z0-9-]+)\/?$/)?.[1];
    if (!this.matchesUrl(url) || !slug) {
      throw new SupplierError("product_unavailable", "That demo supplier link doesn't point to a product.");
    }
    const h = hash(slug);
    const title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const lowStock = slug.includes("low-stock");
    const baseCost = 300 + (h % 1500);
    const sizes = h % 3 === 0 ? ["Default"] : ["Small", "Large"];
    return {
      ref: `demo-${slug}`,
      sourceUrl: url.toString(),
      title,
      description: `${title}.\n\nShips in a gift-ready box. Material and size details come from the supplier listing.`,
      images: [],
      variants: sizes.map((size, i) => ({
        ref: `demo-${slug}-${size.toLowerCase()}`,
        title: size,
        costMinor: baseCost + i * 250,
        stock: lowStock ? 2 : 50 + (h % 400),
        shipDaysMin: 6,
        shipDaysMax: 10,
      })),
    };
  }

  async placeOrder(input: PlaceOrderInput) {
    if (!SHIPS_TO.has(input.address.country)) {
      throw new SupplierError("address_unsupported", `The supplier doesn't ship to ${input.address.country}.`);
    }
    if (input.lines.some((l) => l.variantRef.includes("low-stock"))) {
      throw new SupplierError("out_of_stock", "The supplier is out of stock for an item in this order.");
    }
    const placed = this.now().toString(36);
    return { supplierOrderRef: `DEMO-${input.reference.slice(0, 8).toUpperCase()}-${placed}` };
  }

  async cancelOrder(ref: string) {
    if (await this.getTracking(ref)) return { cancelled: false, message: "The supplier already shipped it." };
    return { cancelled: true, message: null };
  }

  async getTracking(ref: string): Promise<Tracking | null> {
    const placedAt = parseInt(ref.split("-").at(-1) ?? "", 36);
    if (!ref.startsWith("DEMO-") || Number.isNaN(placedAt)) return null;
    const age = this.now() - placedAt;
    if (age < this.shipAfterMs) return null;
    const trackingNumber = `DS${String(hash(ref)).padStart(10, "0")}`;
    return {
      status: age >= this.deliverAfterMs ? "delivered" : "in_transit",
      carrier: "Demo Post",
      trackingNumber,
      url: `https://${DEMO_SUPPLIER_HOST}/track/${trackingNumber}`,
    };
  }
}
