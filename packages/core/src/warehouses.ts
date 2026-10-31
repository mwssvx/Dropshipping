// Supplier warehouses. AliExpress and other suppliers often list the same item from several
// warehouses as a "Ships From" option (China, United States, Spain...), each with its own price and
// delivery time. That isn't a choice for buyers: a store sells from one warehouse, so the import
// keeps the options from the warehouse the merchant picks, drops the "Ships From" option, and
// remembers the country so the product page and the duties note can say where it ships from.
import type { SupplierProduct } from "./suppliers";

const OPTION = /^ships?\s*from$/i;

const ALIASES: Record<string, string> = { usa: "US", "united states of america": "US", uk: "GB", "great britain": "GB", "russian federation": "RU", "czech republic": "CZ" };
let byName: Map<string, string> | null = null;

/** A country code for a supplier's country name ("China", "CZECH REPUBLIC"), or null. */
export function countryFromName(name: string) {
  const key = name.trim().toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  if (!byName) {
    const regions = new Intl.DisplayNames(["en"], { type: "region" });
    byName = new Map();
    for (let a = 65; a <= 90; a++)
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        const n = regions.of(code);
        if (n && n !== code && n !== "Unknown Region") byName.set(n.toLowerCase(), code);
      }
  }
  return byName.get(key) ?? (/^[a-z]{2}$/.test(key) && [...byName.values()].includes(key.toUpperCase()) ? key.toUpperCase() : null);
}

export type Warehouse = { name: string; country: string | null; variants: number; fastestDays: number | null; lowestCostMinor: number };

const optionKey = (options: Record<string, string> | undefined) => Object.keys(options ?? {}).find((k) => OPTION.test(k.trim()));

/** The warehouses a listing ships from, when it has a "Ships From" option. Empty when it doesn't. */
export function warehousesOf(product: SupplierProduct): Warehouse[] {
  const out = new Map<string, Warehouse>();
  for (const v of product.variants) {
    const key = optionKey(v.options);
    if (!key) return [];
    const name = v.options![key]!;
    const w = out.get(name) ?? { name, country: countryFromName(name), variants: 0, fastestDays: null, lowestCostMinor: Infinity };
    w.variants++;
    if (v.shipDaysMax !== null) w.fastestDays = w.fastestDays === null ? v.shipDaysMax : Math.min(w.fastestDays, v.shipDaysMax);
    w.lowestCostMinor = Math.min(w.lowestCostMinor, v.costMinor);
    out.set(name, w);
  }
  return [...out.values()];
}

/**
 * The warehouse picked by default: the one in the store's own country when there is one (fastest,
 * and no customs), else China, where most dropshipping stock sits, else the first listed.
 */
export function defaultWarehouse(warehouses: Warehouse[], storeCountry: string) {
  return (warehouses.find((w) => w.country === storeCountry) ?? warehouses.find((w) => w.country === "CN") ?? warehouses[0])?.name ?? null;
}

/**
 * The listing as sold from one warehouse: only its options, with "Ships From" taken out of their
 * names, and the country it ships from. A listing without the option comes back as it is.
 */
export function fromWarehouse(product: SupplierProduct, storeCountry: string, chosen?: string | null): { product: SupplierProduct; warehouse: string | null; shipsFrom: string | null } {
  const warehouses = warehousesOf(product);
  if (warehouses.length === 0) return { product, warehouse: null, shipsFrom: null };
  const name = warehouses.find((w) => w.name === chosen)?.name ?? defaultWarehouse(warehouses, storeCountry)!;
  const variants = product.variants
    .filter((v) => v.options![optionKey(v.options)!] === name)
    .map((v) => {
      const options = Object.fromEntries(Object.entries(v.options!).filter(([k]) => !OPTION.test(k.trim())));
      const values = Object.values(options);
      return { ...v, options, title: values.length ? values.join(" / ") : "Default" };
    });
  return { product: { ...product, variants }, warehouse: name, shipsFrom: warehouses.find((w) => w.name === name)!.country };
}
