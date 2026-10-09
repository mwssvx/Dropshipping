import { createHmac } from "node:crypto";
import { htmlToText, SupplierError, type PlaceOrderInput, type SupplierAdapter, type SupplierProduct, type Tracking } from "./types";

/**
 * AliExpress, through the Open Platform's dropshipping (DS) APIs. Written from AliExpress's Open
 * Platform reference; not yet run against a live account (no app key in this environment). Covered
 * by tests with recorded-shape responses.
 *
 * Calls go to the "sync" gateway, signed with HMAC-SHA256 over the sorted parameters. Orders are
 * placed for the account that authorised our app (the access token); AliExpress then charges that
 * account's saved payment method, so merchants turn on auto-pay there.
 */
const GATEWAY = "https://api-sg.aliexpress.com/sync";

type Fetch = typeof fetch;
type Params = Record<string, string>;

export type AliExpressOptions = {
  appKey: string;
  appSecret: string;
  accessToken: string;
  /** Prices and shipping are quoted for this country. */
  shipTo?: string;
  fetch?: Fetch;
  now?: () => number;
};

type SkuProperty = { sku_property_name?: string; sku_property_value?: string; property_value_definition_name?: string };
type Sku = {
  sku_id?: string | number;
  sku_attr?: string;
  sku_price?: string;
  offer_sale_price?: string;
  sku_available_stock?: number | string;
  ae_sku_property_dtos?: { ae_sku_property_d_t_o?: SkuProperty[] };
};
type ProductResult = {
  ae_item_base_info_dto?: { subject?: string; detail?: string; product_id?: string | number; product_status_type?: string };
  ae_multimedia_info_dto?: { image_urls?: string };
  ae_item_sku_info_dtos?: { ae_item_sku_info_d_t_o?: Sku[] };
  logistics_info_dto?: { delivery_time?: number | string };
};

/** A variant ref is the AliExpress product id and the SKU's attribute string, which orders need. */
const variantRef = (productId: string, skuAttr: string) => `${productId}|${skuAttr}`;
function splitRef(ref: string) {
  const i = ref.indexOf("|");
  return i < 0 ? { productId: ref, skuAttr: "" } : { productId: ref.slice(0, i), skuAttr: ref.slice(i + 1) };
}

/** The signature AliExpress expects: HMAC-SHA256 of every parameter as key+value, sorted by key, in upper-case hex. */
export function signAliExpress(params: Params, secret: string) {
  const text = Object.keys(params)
    .filter((k) => k !== "sign")
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  return createHmac("sha256", secret).update(text, "utf8").digest("hex").toUpperCase();
}

export class AliExpressSupplier implements SupplierAdapter {
  readonly name = "aliexpress" as const;
  readonly label = "AliExpress";
  private readonly fetch: Fetch;
  private readonly now: () => number;
  private readonly shipTo: string;

  constructor(private readonly opts: AliExpressOptions) {
    this.fetch = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.shipTo = opts.shipTo ?? "US";
  }

  matchesUrl(url: URL) {
    return /(^|\.)aliexpress\.(com|us)$/.test(url.hostname);
  }

  /** Item pages are /item/<id>.html on any AliExpress site; app share links carry productId=<id>. */
  static productIdFromUrl(raw: string): string | null {
    const m = raw.match(/\/item\/(?:[^/]*\/)?(\d{6,})\.html/) ?? raw.match(/[?&]productId=(\d{6,})/);
    return m?.[1] ?? null;
  }

  private async call<T>(method: string, api: Params): Promise<T> {
    const params: Params = {
      ...api,
      method,
      app_key: this.opts.appKey,
      session: this.opts.accessToken,
      timestamp: String(this.now()),
      sign_method: "sha256",
      format: "json",
      v: "2.0",
    };
    params.sign = signAliExpress(params, this.opts.appSecret);
    let res: Response;
    try {
      res = await this.fetch(GATEWAY, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
        body: new URLSearchParams(params).toString(),
      });
    } catch {
      throw new SupplierError("supplier_unreachable", "Couldn't reach AliExpress.", true);
    }
    if (res.status === 429 || res.status >= 500) {
      throw new SupplierError("supplier_unreachable", `AliExpress is having trouble (HTTP ${res.status}).`, true);
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!json) throw new SupplierError("supplier_unreachable", "AliExpress sent an unreadable reply.", true);
    // Gateway errors come back as { error_response: { code, msg, sub_msg } } or as a top-level code.
    const err = (json.error_response as { code?: string; msg?: string; sub_msg?: string } | undefined) ??
      (json.code && json.code !== "0" ? (json as { code?: string; message?: string; msg?: string }) : undefined);
    if (err) {
      const e = err as { code?: string; msg?: string; sub_msg?: string; message?: string };
      throw AliExpressSupplier.toError(String(e.code ?? ""), [e.msg, e.sub_msg, e.message].filter(Boolean).join(": "));
    }
    // Answers are wrapped as { "<method with _ for .>_response": { result: ... } }.
    const wrapped = json[`${method.replace(/\./g, "_")}_response`] as { result?: T } | undefined;
    if (!wrapped || wrapped.result === undefined) {
      throw new SupplierError("supplier_unreachable", "AliExpress sent a reply we didn't understand.", true);
    }
    return wrapped.result;
  }

  private static toError(code: string, message: string): SupplierError {
    const m = `${code} ${message}`.toLowerCase();
    if (m.includes("isv.appkey") || m.includes("invalidsession") || m.includes("session") || m.includes("token") || m.includes("signature")) {
      return new SupplierError("not_connected", "AliExpress rejected our connection. Reconnect the AliExpress account.");
    }
    if (m.includes("frequency") || m.includes("flow control") || m.includes("ratelimit") || m.includes("rate limit")) {
      return new SupplierError("supplier_unreachable", "AliExpress asked us to slow down. We'll try again shortly.", true);
    }
    if (m.includes("balance") || m.includes("payment") || m.includes("pay_fail")) {
      return new SupplierError("insufficient_balance", "AliExpress couldn't charge the account's payment method for this order.");
    }
    if (m.includes("stock") || m.includes("inventory") || m.includes("sku_not_exist")) {
      return new SupplierError("out_of_stock", "AliExpress is out of stock for an item in this order.");
    }
    if (m.includes("deliver") || m.includes("logistic") || m.includes("address") || m.includes("country")) {
      return new SupplierError("address_unsupported", `AliExpress can't ship to this address: ${message}`);
    }
    if (m.includes("product") && (m.includes("not") || m.includes("off") || m.includes("invalid"))) {
      return new SupplierError("product_unavailable", "AliExpress no longer sells this product.");
    }
    return new SupplierError("unknown", `AliExpress said: ${message || code || "unknown error"}`);
  }

  async getProductFromUrl(url: string): Promise<SupplierProduct> {
    const id = AliExpressSupplier.productIdFromUrl(url);
    if (!id) throw new SupplierError("product_unavailable", "That AliExpress link doesn't include a product id. Open the product and copy the link from the address bar.");
    const p = await this.call<ProductResult>("aliexpress.ds.product.get", {
      product_id: id,
      ship_to_country: this.shipTo,
      target_currency: "USD",
      target_language: "en",
    });
    const base = p.ae_item_base_info_dto ?? {};
    if (!base.subject || (base.product_status_type && base.product_status_type !== "onSelling")) {
      throw new SupplierError("product_unavailable", "AliExpress no longer sells this product.");
    }
    const days = Number(p.logistics_info_dto?.delivery_time) || null;
    const skus = p.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o ?? [];
    return {
      ref: id,
      sourceUrl: url,
      title: base.subject,
      description: htmlToText(base.detail ?? ""),
      images: (p.ae_multimedia_info_dto?.image_urls ?? "")
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.startsWith("https://")),
      variants: skus.map((s) => {
        const props = s.ae_sku_property_dtos?.ae_sku_property_d_t_o ?? [];
        const title = props.map((x) => x.property_value_definition_name || x.sku_property_value).filter(Boolean).join(" / ");
        const price = Number(s.offer_sale_price || s.sku_price);
        const stock = s.sku_available_stock === undefined ? null : Number(s.sku_available_stock);
        return {
          ref: variantRef(id, s.sku_attr ?? ""),
          title: title || "Default",
          costMinor: Number.isFinite(price) ? Math.round(price * 100) : 0,
          stock: stock === null || Number.isNaN(stock) ? null : stock,
          shipDaysMin: null,
          shipDaysMax: days,
        };
      }),
    };
  }

  /** The cheapest delivery option AliExpress offers for one line, or undefined to let AliExpress pick. */
  private async cheapestService(productId: string, skuAttr: string, quantity: number, country: string) {
    try {
      const r = await this.call<{ success?: boolean; delivery_options?: { delivery_option_d_t_o?: { code?: string; shipping_fee_cent?: string | number; free_shipping?: boolean }[] } }>(
        "aliexpress.ds.freight.query",
        {
          queryDeliveryReq: JSON.stringify({ quantity, shipToCountry: country, productId, selectedSkuId: skuAttr, language: "en_US", currency: "USD", locale: "en_US" }),
        },
      );
      const options = r.delivery_options?.delivery_option_d_t_o ?? [];
      if (!options.length) return undefined;
      const fee = (o: (typeof options)[number]) => (o.free_shipping ? 0 : Number(o.shipping_fee_cent) || Infinity);
      return [...options].sort((a, b) => fee(a) - fee(b))[0]!.code;
    } catch (e) {
      if (e instanceof SupplierError && e.code === "not_connected") throw e;
      return undefined;
    }
  }

  async placeOrder(input: PlaceOrderInput) {
    const a = input.address;
    const items = [];
    for (const l of input.lines) {
      const { productId, skuAttr } = splitRef(l.variantRef);
      const service = await this.cheapestService(productId, skuAttr, l.quantity, a.country);
      items.push({
        product_id: productId,
        product_count: l.quantity,
        sku_attr: skuAttr,
        ...(service ? { logistics_service_name: service } : {}),
        order_memo: "Please don't include invoices or prices in the parcel.",
      });
    }
    const r = await this.call<{ is_success?: boolean; order_list?: { number?: (string | number)[] }; error_code?: string; error_msg?: string }>(
      "aliexpress.ds.order.create",
      {
        param_place_order_request4_open_api_d_t_o: JSON.stringify({
          out_order_id: input.reference,
          logistics_address: {
            full_name: a.name,
            contact_person: a.name,
            address: a.line1,
            address2: a.line2 ?? "",
            city: a.city,
            province: a.region ?? "",
            zip: a.postalCode,
            country: a.country,
            mobile_no: "",
          },
          product_items: items,
        }),
        ds_extend_request: JSON.stringify({ payment: { pay_currency: "USD", try_pay: true } }),
      },
    );
    const orders = r.order_list?.number ?? [];
    if (!r.is_success || !orders.length) throw AliExpressSupplier.toError(r.error_code ?? "", r.error_msg ?? "the order wasn't created");
    // AliExpress splits an order by seller; we keep every order number so tracking can follow them all.
    return { supplierOrderRef: orders.map(String).join(",") };
  }

  /** The DS APIs can't cancel an order; unpaid orders close on their own, paid ones need the buyer's AliExpress account. */
  async cancelOrder(ref: string) {
    return {
      cancelled: false,
      message: `AliExpress doesn't let apps cancel orders. Cancel order ${ref.split(",").join(", ")} in your AliExpress account before it ships, or ask the seller.`,
    };
  }

  async getTracking(ref: string): Promise<Tracking | null> {
    const found: { status: string; number: string; carrier: string }[] = [];
    for (const orderId of ref.split(",")) {
      const o = await this.call<{ order_status?: string; logistics_info_list?: { ae_order_logistics_info?: { logistics_no?: string; logistics_service?: string }[] } }>(
        "aliexpress.trade.ds.order.get",
        { single_order_query: JSON.stringify({ order_id: orderId }) },
      );
      const l = o.logistics_info_list?.ae_order_logistics_info?.find((x) => x.logistics_no);
      if (!l?.logistics_no) return null;
      found.push({ status: o.order_status ?? "", number: l.logistics_no, carrier: l.logistics_service || "AliExpress Standard Shipping" });
    }
    if (!found.length) return null;
    const first = found[0]!;
    return {
      status: found.every((f) => f.status === "FINISH") ? "delivered" : "in_transit",
      carrier: first.carrier,
      trackingNumber: found.map((f) => f.number).join(", "),
      url: `https://global.cainiao.com/newDetail.htm?mailNoList=${encodeURIComponent(found.map((f) => f.number).join(","))}`,
    };
  }
}
