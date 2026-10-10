import { describe, expect, it } from "vitest";
import { AliExpressSupplier, signAliExpress, suppliersFrom } from "../src";

const address = { name: "Ada Buyer", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

function ae(responses: Record<string, unknown>) {
  const calls: Record<string, string>[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    const params = Object.fromEntries(new URLSearchParams(String(init.body)));
    calls.push(params);
    const method = params.method!;
    const data = responses[method];
    if (data instanceof Error) return new Response(JSON.stringify({ error_response: { code: "isp.error", msg: data.message } }));
    if (data === undefined) return new Response("oops", { status: 502 });
    return new Response(JSON.stringify({ [`${method.replace(/\./g, "_")}_response`]: { result: data } }));
  }) as unknown as typeof fetch;
  return { adapter: new AliExpressSupplier({ appKey: "key", appSecret: "secret", accessToken: "tok", fetch: f, now: () => 1_760_000_000_000 }), calls };
}

const PRODUCT = {
  ae_item_base_info_dto: { subject: "LED Strip Lights", detail: "<p>Bright &amp; bendy</p>", product_id: 1005001234567890, product_status_type: "onSelling" },
  ae_multimedia_info_dto: { image_urls: "https://ae01.alicdn.com/a.jpg;https://ae01.alicdn.com/b.jpg;http://insecure/c.jpg" },
  logistics_info_dto: { delivery_time: 12 },
  ae_item_sku_info_dtos: {
    ae_item_sku_info_d_t_o: [
      {
        sku_attr: "14:193#5m",
        sku_price: "9.99",
        offer_sale_price: "7.45",
        sku_available_stock: 120,
        ae_sku_property_dtos: { ae_sku_property_d_t_o: [{ sku_property_name: "Length", sku_property_value: "5m" }] },
      },
      {
        sku_attr: "14:194#10m",
        sku_price: "14.50",
        sku_available_stock: 0,
        ae_sku_property_dtos: { ae_sku_property_d_t_o: [{ sku_property_name: "Length", sku_property_value: "10m", property_value_definition_name: "10 metres" }] },
      },
    ],
  },
};

describe("AliExpress adapter", () => {
  it("signs requests the way the Open Platform checks them", () => {
    // Sorted key+value pairs, HMAC-SHA256 with the app secret, upper-case hex.
    expect(signAliExpress({ b: "2", a: "1", sign: "ignored" }, "secret")).toBe("3A9F9E53162A24430830CCA87B7FB623401B81EB6616A6EA75B3614AEBDC7F4D");
  });

  it("reads a product link into options with cost, stock and delivery time", async () => {
    const { adapter, calls } = ae({ "aliexpress.ds.product.get": PRODUCT });
    const url = "https://www.aliexpress.com/item/1005001234567890.html?spm=a2g0o";
    expect(adapter.matchesUrl(new URL(url))).toBe(true);
    expect(adapter.matchesUrl(new URL("https://www.aliexpress.us/item/1005001234567890.html"))).toBe(true);
    expect(adapter.matchesUrl(new URL("https://fake-aliexpress.com/item/1.html"))).toBe(false);
    const p = await adapter.getProductFromUrl(url);
    expect(p).toMatchObject({ ref: "1005001234567890", title: "LED Strip Lights", description: "Bright & bendy" });
    expect(p.images).toEqual(["https://ae01.alicdn.com/a.jpg", "https://ae01.alicdn.com/b.jpg"]);
    expect(p.variants).toEqual([
      { ref: "1005001234567890|14:193#5m", title: "5m", options: { Length: "5m" }, costMinor: 745, stock: 120, shipDaysMin: null, shipDaysMax: 12 },
      { ref: "1005001234567890|14:194#10m", title: "10 metres", options: { Length: "10 metres" }, costMinor: 1450, stock: 0, shipDaysMin: null, shipDaysMax: 12 },
    ]);
    const call = calls[0]!;
    expect(call).toMatchObject({ method: "aliexpress.ds.product.get", product_id: "1005001234567890", app_key: "key", session: "tok", sign_method: "sha256", ship_to_country: "US" });
    const { sign, ...rest } = call;
    expect(sign).toBe(signAliExpress(rest, "secret"));
  });

  it("explains links it can't use and listings that are gone", async () => {
    const { adapter } = ae({ "aliexpress.ds.product.get": { ...PRODUCT, ae_item_base_info_dto: { subject: "Gone", product_status_type: "offline" } } });
    await expect(adapter.getProductFromUrl("https://www.aliexpress.com/store/123")).rejects.toMatchObject({ code: "product_unavailable" });
    await expect(adapter.getProductFromUrl("https://www.aliexpress.com/item/1005001234567890.html")).rejects.toMatchObject({ code: "product_unavailable" });
    const down = ae({});
    await expect(down.adapter.getProductFromUrl("https://www.aliexpress.com/item/1005001234567890.html")).rejects.toMatchObject({ code: "supplier_unreachable", retryable: true });
    const signedOut = ae({ "aliexpress.ds.product.get": new Error("Invalid session") });
    await expect(signedOut.adapter.getProductFromUrl("https://www.aliexpress.com/item/1005001234567890.html")).rejects.toMatchObject({ code: "not_connected" });
  });

  it("places an order with the cheapest delivery and our reference, and follows every parcel", async () => {
    const { adapter, calls } = ae({
      "aliexpress.ds.freight.query": {
        success: true,
        delivery_options: {
          delivery_option_d_t_o: [
            { code: "FEDEX", shipping_fee_cent: "1200" },
            { code: "CAINIAO_STANDARD", free_shipping: true },
          ],
        },
      },
      "aliexpress.ds.order.create": { is_success: true, order_list: { number: [8100000001, 8100000002] } },
      "aliexpress.trade.ds.order.get": { order_status: "WAIT_BUYER_ACCEPT_GOODS", logistics_info_list: { ae_order_logistics_info: [{ logistics_no: "LP001", logistics_service: "Cainiao Standard" }] } },
    });
    const res = await adapter.placeOrder({ reference: "ful-1", email: "a@b.co", address, lines: [{ variantRef: "1005001234567890|14:193#5m", quantity: 2 }] });
    expect(res.supplierOrderRef).toBe("8100000001,8100000002");
    const order = calls.find((c) => c.method === "aliexpress.ds.order.create")!;
    const body = JSON.parse(order.param_place_order_request4_open_api_d_t_o!);
    expect(body).toMatchObject({
      out_order_id: "ful-1",
      logistics_address: { full_name: "Ada Buyer", city: "Austin", province: "TX", zip: "78701", country: "US" },
      product_items: [{ product_id: "1005001234567890", sku_attr: "14:193#5m", product_count: 2, logistics_service_name: "CAINIAO_STANDARD" }],
    });
    const tracking = await adapter.getTracking(res.supplierOrderRef);
    expect(tracking).toMatchObject({ status: "in_transit", carrier: "Cainiao Standard", trackingNumber: "LP001, LP001" });
    expect(tracking!.url).toContain("cainiao.com");
    expect(await adapter.cancelOrder("8100000001")).toMatchObject({ cancelled: false });
  });

  it("waits for tracking until every part of the order has shipped, and maps order errors", async () => {
    const { adapter } = ae({ "aliexpress.trade.ds.order.get": { order_status: "WAIT_SELLER_SEND_GOODS" } });
    expect(await adapter.getTracking("8100000001")).toBeNull();
    const broke = ae({ "aliexpress.ds.freight.query": { delivery_options: {} }, "aliexpress.ds.order.create": { is_success: false, error_code: "DELIVERY_METHOD_NOT_EXIST", error_msg: "no delivery to this country" } });
    await expect(broke.adapter.placeOrder({ reference: "r", email: "a@b.co", address, lines: [{ variantRef: "1|", quantity: 1 }] })).rejects.toMatchObject({ code: "address_unsupported" });
  });

  it("points AliExpress links at the right message when AliExpress isn't connected", () => {
    const list = suppliersFrom([]);
    expect(() => list.forUrl("https://www.aliexpress.com/item/1005001234567890.html")).toThrow(/AliExpress isn't connected/);
  });
});
