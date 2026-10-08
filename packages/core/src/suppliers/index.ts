// Supplier adapters (milestone 2). The interface is fixed now so the order flow can depend on it.
export type SupplierProduct = {
  ref: string;
  title: string;
  descriptionHtml: string;
  images: string[];
  variants: { ref: string; title: string; costMinor: number; stock: number | null; shipDaysMin: number; shipDaysMax: number }[];
};

export interface SupplierAdapter {
  readonly name: "fake" | "cj";
  getProductFromUrl(url: string): Promise<SupplierProduct>;
  placeOrder(input: { lines: { variantRef: string; quantity: number }[]; address: unknown; reference: string }): Promise<{ supplierOrderRef: string }>;
  getTracking(supplierOrderRef: string): Promise<{ carrier: string; trackingNumber: string; url: string } | null>;
}

/** CJ Dropshipping (official API). Wired up in milestone 2 once a CJ API key exists. */
export class CjSupplier implements SupplierAdapter {
  readonly name = "cj" as const;
  constructor(private readonly apiKey: string | undefined) {}
  private notReady(): never {
    throw new Error(this.apiKey ? "CJ adapter arrives in milestone 2." : "CJ_API_KEY is not set.");
  }
  getProductFromUrl(): Promise<SupplierProduct> { return this.notReady(); }
  placeOrder(): Promise<{ supplierOrderRef: string }> { return this.notReady(); }
  getTracking(): Promise<null> { return this.notReady(); }
}
