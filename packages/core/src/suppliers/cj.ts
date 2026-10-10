import { htmlToText, SupplierError, type PlaceOrderInput, type SupplierAdapter, type SupplierProduct, type Tracking } from "./types";

/**
 * CJ Dropshipping, API 2.0. Written from CJ's public API reference; not yet run against a live
 * account (no key in this environment). Covered by tests with recorded-shape responses.
 */
const BASE = "https://developers.cjdropshipping.com/api2.0/v1";

type CjResponse<T> = { code: number; result: boolean; message: string; data: T };
type Fetch = typeof fetch;

export type CjOptions = { apiKey: string; fetch?: Fetch; now?: () => number };

/** "Color-Size" and "Black-XL" make { Color: "Black", Size: "XL" }; anything that doesn't line up makes none. */
export function cjOptions(keys: string | undefined, values: string | undefined): Record<string, string> {
  if (!keys || !values) return {};
  const names = keys.split("-").map((k) => k.trim());
  const parts = values.split("-").map((v) => v.trim());
  if (names.length !== parts.length || names.some((n) => !n) || parts.some((v) => !v)) return {};
  return Object.fromEntries(names.map((n, i) => [n, parts[i]!]));
}

export class CjSupplier implements SupplierAdapter {
  readonly name = "cj" as const;
  readonly label = "CJ Dropshipping";
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetch: Fetch;
  private readonly now: () => number;

  constructor(private readonly opts: CjOptions) {
    this.fetch = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  matchesUrl(url: URL) {
    return /(^|\.)cjdropshipping\.com$/.test(url.hostname);
  }

  /** CJ product pages end in "-p-<pid>.html"; a bare pid also works. */
  static productIdFromUrl(raw: string): string | null {
    const m = raw.match(/-p-([0-9A-Za-z-]{10,})\.html/) ?? raw.match(/[?&]pid=([0-9A-Za-z-]{10,})/);
    return m?.[1] ?? null;
  }

  private async accessToken() {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    const data = await this.call<{ accessToken: string; accessTokenExpiryDate: string }>(
      "POST",
      "/authentication/getAccessToken",
      { apiKey: this.opts.apiKey },
      false,
    );
    const expiresAt = Date.parse(data.accessTokenExpiryDate) || this.now() + 24 * 3600_000;
    this.token = { value: data.accessToken, expiresAt };
    return data.accessToken;
  }

  private async call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (auth) headers["CJ-Access-Token"] = await this.accessToken();
    const url = method !== "POST" && body ? `${BASE}${path}?${new URLSearchParams(body as Record<string, string>)}` : `${BASE}${path}`;
    let res: Response;
    try {
      res = await this.fetch(url, { method, headers, body: method === "POST" ? JSON.stringify(body ?? {}) : undefined });
    } catch {
      throw new SupplierError("supplier_unreachable", "Couldn't reach CJ Dropshipping.", true);
    }
    if (res.status === 429 || res.status >= 500) {
      throw new SupplierError("supplier_unreachable", `CJ Dropshipping is having trouble (HTTP ${res.status}).`, true);
    }
    const json = (await res.json().catch(() => null)) as CjResponse<T> | null;
    if (!json) throw new SupplierError("supplier_unreachable", "CJ Dropshipping sent an unreadable reply.", true);
    if (json.code !== 200 || json.result === false) throw CjSupplier.toError(json.message ?? "", res.status);
    return json.data;
  }

  private static toError(message: string, status: number): SupplierError {
    const m = message.toLowerCase();
    if (status === 401 || m.includes("token") || m.includes("apikey") || m.includes("api key")) {
      return new SupplierError("not_connected", "CJ Dropshipping rejected the API key. Check it in CJ and reconnect.");
    }
    if (m.includes("balance") || m.includes("insufficient")) {
      return new SupplierError("insufficient_balance", "Your CJ wallet doesn't have enough balance to pay for this order.");
    }
    if (m.includes("stock") || m.includes("inventory")) {
      return new SupplierError("out_of_stock", "CJ is out of stock for an item in this order.");
    }
    if (m.includes("country") || m.includes("address") || m.includes("logistic")) {
      return new SupplierError("address_unsupported", `CJ can't ship to this address: ${message}`);
    }
    if (m.includes("product") && (m.includes("not") || m.includes("off"))) {
      return new SupplierError("product_unavailable", "CJ no longer sells this product.");
    }
    return new SupplierError("unknown", `CJ Dropshipping said: ${message || "unknown error"}`);
  }

  async getProductFromUrl(url: string): Promise<SupplierProduct> {
    const pid = CjSupplier.productIdFromUrl(url);
    if (!pid) throw new SupplierError("product_unavailable", "That CJ link doesn't include a product id.");
    const p = await this.call<{
      pid: string;
      productNameEn: string;
      /** The option names, like "Color-Size", in the order variant keys use. */
      productKeyEn?: string;
      description?: string;
      productImageSet?: string[];
      productImage?: string;
      variants: { vid: string; variantNameEn?: string; variantKey?: string; variantImage?: string; variantSellPrice: number | string }[];
    }>("GET", "/product/query", { pid });
    const images = p.productImageSet?.length ? p.productImageSet : p.productImage ? parseImageList(p.productImage) : [];
    return {
      ref: p.pid,
      sourceUrl: url,
      title: p.productNameEn,
      description: htmlToText(p.description ?? ""),
      images: images.filter((i) => i.startsWith("https://")),
      variants: p.variants.map((v) => ({
        ref: v.vid,
        title: v.variantKey || v.variantNameEn || "Default",
        options: cjOptions(p.productKeyEn, v.variantKey),
        imageUrl: v.variantImage?.startsWith("https://") ? v.variantImage : null,
        costMinor: Math.round(Number(v.variantSellPrice) * 100),
        stock: null,
        shipDaysMin: null,
        shipDaysMax: null,
      })),
    };
  }

  async placeOrder(input: PlaceOrderInput) {
    const a = input.address;
    const products = input.lines.map((l) => ({ vid: l.variantRef, quantity: l.quantity }));
    const options = await this.call<{ logisticName: string; logisticPrice: number }[]>("POST", "/logistic/freightCalculate", {
      startCountryCode: "CN",
      endCountryCode: a.country,
      zip: a.postalCode,
      products,
    });
    if (!options.length) throw new SupplierError("address_unsupported", `CJ has no shipping option to ${a.country} for these items.`);
    const cheapest = [...options].sort((x, y) => x.logisticPrice - y.logisticPrice)[0]!;
    const order = await this.call<{ orderId: string }>("POST", "/shopping/order/createOrderV2", {
      orderNumber: input.reference,
      shippingCountryCode: a.country,
      shippingProvince: a.region ?? "",
      shippingCity: a.city,
      shippingAddress: a.line1,
      shippingAddress2: a.line2 ?? "",
      shippingZip: a.postalCode,
      shippingCustomerName: a.name,
      shippingPhone: "",
      email: input.email,
      logisticName: cheapest.logisticName,
      fromCountryCode: "CN",
      products,
    });
    return { supplierOrderRef: order.orderId };
  }

  /** CJ only lets you delete an order before it's paid and processed; after that, ask CJ support. */
  async cancelOrder(orderId: string) {
    try {
      await this.call("DELETE", "/shopping/order/deleteOrder", { orderId });
      return { cancelled: true, message: null };
    } catch (e) {
      if (e instanceof SupplierError && !e.retryable) {
        return { cancelled: false, message: `CJ wouldn't cancel it (${e.message}). Ask CJ support to cancel order ${orderId}.` };
      }
      throw e;
    }
  }

  async getTracking(orderId: string): Promise<Tracking | null> {
    const o = await this.call<{ orderStatus: string; trackNumber?: string | null; logisticName?: string | null }>(
      "GET",
      "/shopping/order/getOrderDetail",
      { orderId },
    );
    if (!o.trackNumber) return null;
    return {
      status: o.orderStatus === "DELIVERED" ? "delivered" : "in_transit",
      carrier: o.logisticName || "CJ Packet",
      trackingNumber: o.trackNumber,
      url: `https://cjpacket.com/?trackingNumber=${encodeURIComponent(o.trackNumber)}`,
    };
  }
}

function parseImageList(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [String(v)];
  } catch {
    return s.split(",").map((x) => x.trim()).filter(Boolean);
  }
}
