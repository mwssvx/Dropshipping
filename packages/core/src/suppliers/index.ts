import { AliExpressSupplier } from "./aliexpress";
import { CjSupplier } from "./cj";
import { FakeSupplier } from "./fake";
import { SupplierError, type SupplierAdapter, type SupplierName } from "./types";

export * from "./types";
export { FakeSupplier, DEMO_SUPPLIER_HOST, DEMO_SUPPLIER_LINKS } from "./fake";
export { CjSupplier, cjOptions } from "./cj";
export { AliExpressSupplier, signAliExpress } from "./aliexpress";

export type Suppliers = {
  get(name: SupplierName): SupplierAdapter;
  /** The supplier a product link belongs to, or a SupplierError explaining what's supported. */
  forUrl(url: string): SupplierAdapter;
  available: SupplierAdapter[];
};

const LABELS: Record<SupplierName, string> = { fake: "demo supplier", cj: "CJ Dropshipping", aliexpress: "AliExpress" };

export function suppliersFrom(list: SupplierAdapter[]): Suppliers {
  return {
    available: list,
    get(name) {
      const s = list.find((x) => x.name === name);
      if (!s) throw new SupplierError("not_connected", `The ${LABELS[name]} connection isn't set up.`);
      return s;
    },
    forUrl(raw) {
      let url: URL;
      try {
        url = new URL(raw.trim());
      } catch {
        throw new SupplierError("product_unavailable", "Paste the full product link, starting with https://");
      }
      const s = list.find((x) => x.matchesUrl(url));
      if (s) return s;
      if (/(^|\.)cjdropshipping\.com$/.test(url.hostname)) {
        throw new SupplierError("not_connected", "CJ Dropshipping isn't connected yet. Add your CJ API key to import from CJ.");
      }
      if (/(^|\.)aliexpress\.(com|us)$/.test(url.hostname)) {
        throw new SupplierError("not_connected", "AliExpress isn't connected yet. Connect an AliExpress account to import from AliExpress.");
      }
      throw new SupplierError("product_unavailable", "That link isn't from a supported supplier. CJ Dropshipping and AliExpress links work once they're connected.");
    },
  };
}

/**
 * The demo supplier is on unless DEMO_SUPPLIER=off. CJ is on when CJ_API_KEY is set, AliExpress
 * when its app key, app secret and the access token from authorising the account are all set.
 */
export function suppliersFromEnv(env: Record<string, string | undefined>): Suppliers {
  const list: SupplierAdapter[] = [];
  if (env.CJ_API_KEY) list.push(new CjSupplier({ apiKey: env.CJ_API_KEY }));
  if (env.ALIEXPRESS_APP_KEY && env.ALIEXPRESS_APP_SECRET && env.ALIEXPRESS_ACCESS_TOKEN) {
    list.push(
      new AliExpressSupplier({
        appKey: env.ALIEXPRESS_APP_KEY,
        appSecret: env.ALIEXPRESS_APP_SECRET,
        accessToken: env.ALIEXPRESS_ACCESS_TOKEN,
        shipTo: env.ALIEXPRESS_SHIP_TO || undefined,
      }),
    );
  }
  if (env.DEMO_SUPPLIER !== "off") {
    list.push(new FakeSupplier({ shipAfterMs: Number(env.DEMO_SUPPLIER_SHIP_AFTER_SECONDS ?? 0) * 1000 }));
  }
  return suppliersFrom(list);
}
