// Take your store with you: everything that makes up a store (products, collections, pages, theme,
// codes, settings) as one JSON file that loads into a new store, plus products as CSV.
// Orders and customers stay out of the JSON file: they belong to the payments account.
import { asc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { CURRENCIES } from "./currency";
import { csvCell } from "./payouts";
import { photoColumns } from "./gallery";
import { addRedirect } from "./redirects";
import { parseTheme } from "./theme-doc";
import { listShippingZones } from "./shipping";

export const EXPORT_FORMAT = "storefront-store";

function supplierOf(link: typeof schema.suppliers.$inferSelect | undefined, productRef: string | null) {
  if (!link) return null;
  return link.provider === "email"
    ? { provider: link.provider, product_ref: null, name: link.name, email: link.contactEmail }
    : { provider: link.provider, product_ref: productRef };
}

export async function exportStore(db: Db, shopId: string, now = new Date()) {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  if (!shop) throw new NotFoundError("Store");
  const [products, collections, links, pages, theme, discounts, supplierRows, posts, redirectRows] = await Promise.all([
    db.query.products.findMany({ where: eq(schema.products.shopId, shopId), orderBy: asc(schema.products.createdAt) }),
    db.query.collections.findMany({ where: eq(schema.collections.shopId, shopId), orderBy: asc(schema.collections.createdAt) }),
    db
      .select({ l: schema.collectionProducts })
      .from(schema.collectionProducts)
      .innerJoin(schema.collections, eq(schema.collections.id, schema.collectionProducts.collectionId))
      .where(eq(schema.collections.shopId, shopId))
      .orderBy(asc(schema.collectionProducts.position)),
    db.query.pages.findMany({ where: eq(schema.pages.shopId, shopId), orderBy: asc(schema.pages.createdAt) }),
    db.query.themes.findFirst({ where: eq(schema.themes.shopId, shopId) }),
    db.query.discounts.findMany({ where: eq(schema.discounts.shopId, shopId), orderBy: asc(schema.discounts.createdAt) }),
    db.query.suppliers.findMany({ where: eq(schema.suppliers.shopId, shopId) }),
    db.query.blogPosts.findMany({ where: eq(schema.blogPosts.shopId, shopId), orderBy: asc(schema.blogPosts.createdAt) }),
    db.query.redirects.findMany({ where: eq(schema.redirects.shopId, shopId), orderBy: asc(schema.redirects.fromPath) }),
  ]);
  const variants = products.length
    ? await db.query.variants.findMany({ where: inArray(schema.variants.productId, products.map((p) => p.id)), orderBy: asc(schema.variants.position) })
    : [];
  const handleOf = new Map(products.map((p) => [p.id, p.handle]));
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const shipping = await listShippingZones(db, shopId);
  return {
    format: EXPORT_FORMAT,
    version: 1,
    exported_at: now.toISOString(),
    store: {
      name: shop.name,
      currency: shop.currency,
      country: shop.country,
      prices_include_tax: shop.pricesIncludeTax,
      abandoned_cart_emails: shop.abandonedCartEmails,
      reviews_auto_publish: shop.reviewsAutoPublish,
      presentment_currencies: shop.presentmentCurrencies,
      round_converted_prices: shop.roundConvertedPrices,
      wholesale: { enabled: shop.wholesaleEnabled, percent_off: shop.wholesalePercentOff, min_order_minor: shop.wholesaleMinOrderMinor },
      // Missing means the built-in default rate.
      shipping_zones: shipping.isDefault
        ? undefined
        : shipping.zones.map((z) => ({
            name: z.name,
            countries: z.countries,
            rates: z.rates.map((r) => ({ name: r.name, price_minor: r.priceMinor, free_over_minor: r.freeOverMinor, min_days: r.minDays, max_days: r.maxDays })),
          })),
    },
    theme: theme ? { template: theme.template, draft: theme.draft, published: theme.published } : null,
    products: products.map((p) => ({
      handle: p.handle,
      title: p.title,
      description_html: p.descriptionHtml,
      image_url: p.imageUrl,
      images: p.images,
      status: p.status,
      source_url: p.sourceUrl,
      supplier: p.supplierId ? supplierOf(supplierRows.find((s) => s.id === p.supplierId), p.supplierProductRef) : null,
      goes_well_with: p.upsellProductId ? (handleOf.get(p.upsellProductId) ?? null) : null,
      quantity_breaks: p.quantityBreaks.map((t) => ({ min_qty: t.minQty, percent_off: t.percentOff })),
      gift_card: p.giftCard,
      variants: variants
        .filter((v) => v.productId === p.id)
        .map((v) => ({
          title: v.title,
          options: v.options,
          sku: v.sku,
          supplier_ref: v.supplierVariantRef,
          price: v.priceMinor,
          compare_at_price: v.compareAtMinor,
          cost: v.costMinor,
          stock: v.stock,
          ship_days_min: v.shipDaysMin,
          ship_days_max: v.shipDaysMax,
        })),
    })),
    collections: collections.map((c) => ({
      // Kept so home page sections that point at a collection still do after loading.
      id: c.id,
      handle: c.handle,
      title: c.title,
      description: c.description,
      image_url: c.imageUrl,
      products: links.filter(({ l }) => l.collectionId === c.id).map(({ l }) => handleOf.get(l.productId)!),
    })),
    pages: pages.map((p) => ({ handle: p.handle, title: p.title, body: p.body, seo_description: p.seoDescription, published: p.published })),
    blog_posts: posts.map((p) => ({
      handle: p.handle,
      title: p.title,
      excerpt: p.excerpt,
      body: p.body,
      image_url: p.imageUrl,
      products: p.productIds.map((id) => handleOf.get(id)).filter((h): h is string => !!h),
      published_at: p.status === "published" ? p.publishedAt?.toISOString() ?? null : null,
    })),
    discount_codes: discounts.map((d) => ({
      code: d.code,
      kind: d.kind,
      value: d.value,
      min_subtotal: d.minSubtotalMinor,
      usage_limit: d.usageLimit,
      once_per_customer: d.oncePerCustomer,
      starts_at: iso(d.startsAt),
      ends_at: iso(d.endsAt),
      active: d.active,
    })),
    redirects: redirectRows.map((r) => ({ from: r.fromPath, to: r.toPath })),
  };
}

export type StoreExport = Awaited<ReturnType<typeof exportStore>>;

const handle = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "A handle in the file isn't valid.");
const money = z.number().int().min(0).max(100_000_000);
const str = (max: number) => z.string().max(max);
const date = z.string().datetime().nullable().optional();

const importSchema = z.object({
  format: z.literal(EXPORT_FORMAT, { errorMap: () => ({ message: "This isn't a store file from us." }) }),
  version: z.literal(1, { errorMap: () => ({ message: "This store file is from a newer version. Update and try again." }) }),
  store: z
    .object({
      prices_include_tax: z.boolean().optional(),
      abandoned_cart_emails: z.boolean().optional(),
      reviews_auto_publish: z.boolean().optional(),
      presentment_currencies: z.array(z.enum(CURRENCIES)).max(CURRENCIES.length).optional(),
      round_converted_prices: z.boolean().optional(),
      wholesale: z
        .object({ enabled: z.boolean(), percent_off: z.number().int().min(1).max(80), min_order_minor: z.number().int().min(0).max(100_000_000) })
        .optional(),
      shipping_zones: z
        .array(
          z.object({
            name: str(60),
            countries: z.array(z.string().regex(/^([A-Z]{2}|\*)$/)).min(1).max(60),
            rates: z
              .array(
                z.object({
                  name: str(40),
                  price_minor: z.number().int().min(0).max(1_000_000),
                  free_over_minor: z.number().int().min(1).max(100_000_000).nullable(),
                  min_days: z.number().int().min(0).max(120).nullable(),
                  max_days: z.number().int().min(0).max(120).nullable(),
                }),
              )
              .max(5),
          }),
        )
        .max(50)
        .optional(),
    })
    .passthrough(),
  theme: z.object({ template: str(40), draft: z.unknown(), published: z.unknown() }).nullable().optional(),
  products: z
    .array(
      z.object({
        handle,
        title: str(200).min(1),
        description_html: str(100_000).default(""),
        image_url: str(2000).nullable().optional(),
        images: z.array(str(2000)).max(10).optional(),
        status: z.enum(["draft", "active", "archived"]),
        source_url: str(2000).nullable().optional(),
        supplier: z
          .object({
            provider: z.enum(["fake", "cj", "email"]).nullable(),
            product_ref: str(200).nullable(),
            // Own suppliers only.
            name: str(100).nullable().optional(),
            email: z.string().email().max(320).nullable().optional(),
          })
          .nullable()
          .optional(),
        goes_well_with: handle.nullable().optional(),
        gift_card: z.boolean().optional(),
        quantity_breaks: z
          .array(z.object({ min_qty: z.number().int().min(2).max(99), percent_off: z.number().int().min(1).max(80) }))
          .max(3)
          .optional(),
        variants: z
          .array(
            z.object({
              title: str(200).default("Default"),
              options: z.record(z.string(), z.string()).default({}),
              sku: str(100).nullable().optional(),
              supplier_ref: str(200).nullable().optional(),
              price: money,
              compare_at_price: money.nullable().optional(),
              cost: money.nullable().optional(),
              stock: z.number().int().min(0).nullable().optional(),
              ship_days_min: z.number().int().min(0).max(365).nullable().optional(),
              ship_days_max: z.number().int().min(0).max(365).nullable().optional(),
            }),
          )
          .min(1, "Every product needs at least one variant.")
          .max(100),
      }),
    )
    .max(5000, "The file has more than 5,000 products."),
  collections: z
    .array(z.object({ id: z.string().uuid().optional(), handle, title: str(200).min(1), description: str(5000).default(""), image_url: str(2000).nullable().optional(), products: z.array(handle).max(5000) }))
    .max(500)
    .default([]),
  pages: z.array(z.object({ handle, title: str(200).min(1), body: str(100_000).default(""), seo_description: str(320).nullable().optional(), published: z.boolean().default(true) })).max(200).default([]),
  blog_posts: z
    .array(
      z.object({
        handle,
        title: str(200).min(1),
        excerpt: str(320).nullable().optional(),
        body: str(60_000).default(""),
        image_url: str(2000).nullable().optional(),
        products: z.array(handle).max(8).default([]),
        published_at: z.string().datetime().nullable().optional(),
      }),
    )
    .max(1000)
    .default([]),
  redirects: z
    .array(z.object({ from: str(500), to: str(2000) }))
    .max(2000)
    .default([]),
  discount_codes: z
    .array(
      z.object({
        code: z.string().regex(/^[A-Z0-9_-]{3,30}$/),
        kind: z.enum(["percent", "amount", "free_shipping"]),
        value: z.number().int().min(0),
        min_subtotal: money.default(0),
        usage_limit: z.number().int().min(1).nullable().optional(),
        once_per_customer: z.boolean().default(false),
        starts_at: date,
        ends_at: date,
        active: z.boolean().default(true),
      }),
    )
    .max(1000)
    .default([]),
});

/**
 * Loads a store file into a store that has no products, collections or pages yet. All or nothing:
 * if anything in the file is wrong, nothing is added.
 */
export async function importStore(db: Db, shopId: string, input: unknown) {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new UserError(issue.path.length < 2 ? issue.message : `${issue.message} (at ${issue.path.join(".")})`);
  }
  const data = parsed.data;
  const unique = (list: string[], what: string) => {
    const seen = new Set<string>();
    for (const h of list) {
      if (seen.has(h)) throw new UserError(`Two ${what} in the file share "${h}".`);
      seen.add(h);
    }
  };
  unique(data.products.map((p) => p.handle), "products");
  unique(data.collections.map((c) => c.handle), "collections");
  unique(data.pages.map((p) => p.handle), "pages");
  unique(data.blog_posts.map((p) => p.handle), "blog posts");
  unique(data.discount_codes.map((d) => d.code), "codes");
  const theme = data.theme ? { draft: parseTheme(data.theme.draft), published: parseTheme(data.theme.published) } : null;

  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  if (!shop) throw new NotFoundError("Store");
  const [p, c, pg] = await Promise.all([
    db.query.products.findFirst({ where: eq(schema.products.shopId, shopId), columns: { id: true } }),
    db.query.collections.findFirst({ where: eq(schema.collections.shopId, shopId), columns: { id: true } }),
    db.query.pages.findFirst({ where: eq(schema.pages.shopId, shopId), columns: { id: true } }),
  ]);
  if (p || c || pg) throw new UserError("Load a store file into a new, empty store. This one already has products, collections or pages.");

  return db.transaction(async (tx) => {
    // Keyed by provider, or "email:<address>" for an own supplier.
    const supplierIds = new Map<string, string>();
    const keyOf = (sup: (typeof data.products)[number]["supplier"]) =>
      !sup?.provider ? null : sup.provider === "email" ? (sup.email && sup.name ? `email:${sup.email.toLowerCase()}` : null) : sup.provider;
    for (const x of data.products) {
      const key = keyOf(x.supplier);
      if (!key || supplierIds.has(key)) continue;
      const own = x.supplier!.provider === "email";
      const [link] = await tx
        .insert(schema.suppliers)
        .values({ shopId, provider: x.supplier!.provider!, ...(own ? { name: x.supplier!.name!, contactEmail: x.supplier!.email!.toLowerCase() } : {}) })
        .onConflictDoUpdate({ target: [schema.suppliers.shopId, schema.suppliers.provider, schema.suppliers.contactEmail], set: { status: "connected" } })
        .returning({ id: schema.suppliers.id });
      supplierIds.set(key, link!.id);
    }
    const productIds = new Map<string, string>();
    for (const x of data.products) {
      const key = keyOf(x.supplier);
      const provider = key && x.supplier?.provider !== "email" ? key : null;
      const [row] = await tx
        .insert(schema.products)
        .values({
          shopId,
          handle: x.handle,
          title: x.title,
          descriptionHtml: x.description_html,
          ...photoColumns(x.images?.length ? x.images : x.image_url ? [x.image_url] : []),
          status: x.status,
          sourceUrl: x.source_url ?? null,
          supplierId: key ? supplierIds.get(key)! : null,
          supplierProductRef: provider ? (x.supplier?.product_ref ?? null) : null,
          quantityBreaks: (x.quantity_breaks ?? []).map((t) => ({ minQty: t.min_qty, percentOff: t.percent_off })).sort((a, b) => a.minQty - b.minQty),
          giftCard: x.gift_card ?? false,
        })
        .returning({ id: schema.products.id });
      productIds.set(x.handle, row!.id);
      await tx.insert(schema.variants).values(
        x.variants.map((v, i) => ({
          productId: row!.id,
          title: v.title,
          options: v.options,
          sku: v.sku ?? null,
          supplierVariantRef: provider ? (v.supplier_ref ?? null) : null,
          priceMinor: v.price,
          compareAtMinor: v.compare_at_price ?? null,
          costMinor: v.cost ?? null,
          stock: v.stock ?? null,
          shipDaysMin: v.ship_days_min ?? null,
          shipDaysMax: v.ship_days_max ?? null,
          position: i,
        })),
      );
    }
    for (const x of data.products) {
      const target = x.goes_well_with ? productIds.get(x.goes_well_with) : undefined;
      if (target && target !== productIds.get(x.handle)) {
        await tx.update(schema.products).set({ upsellProductId: target }).where(eq(schema.products.id, productIds.get(x.handle)!));
      }
    }
    const collectionIds = new Map<string, string>();
    for (const x of data.collections) {
      const [row] = await tx
        .insert(schema.collections)
        .values({ shopId, handle: x.handle, title: x.title, description: x.description, imageUrl: x.image_url ?? null })
        .returning({ id: schema.collections.id });
      if (x.id) collectionIds.set(x.id, row!.id);
      const members = x.products.map((h) => productIds.get(h)).filter((id): id is string => !!id);
      if (members.length) await tx.insert(schema.collectionProducts).values([...new Set(members)].map((productId, position) => ({ collectionId: row!.id, productId, position })));
    }
    if (data.pages.length) {
      await tx.insert(schema.pages).values(data.pages.map((x) => ({ shopId, handle: x.handle, title: x.title, body: x.body, seoDescription: x.seo_description ?? null, published: x.published })));
    }
    if (data.blog_posts.length) {
      await tx.insert(schema.blogPosts).values(
        data.blog_posts.map((x) => ({
          shopId,
          handle: x.handle,
          title: x.title,
          excerpt: x.excerpt ?? null,
          body: x.body.replace(/<[^>]*>/g, ""),
          imageUrl: x.image_url && /^https:\/\//.test(x.image_url) ? x.image_url : null,
          productIds: x.products.map((h) => productIds.get(h)).filter((id): id is string => !!id),
          status: x.published_at ? ("published" as const) : ("draft" as const),
          publishedAt: x.published_at ? new Date(x.published_at) : null,
        })),
      );
    }
    for (const d of data.discount_codes) {
      await tx
        .insert(schema.discounts)
        .values({
          shopId,
          code: d.code,
          kind: d.kind,
          value: d.kind === "free_shipping" ? 0 : d.value,
          minSubtotalMinor: d.min_subtotal,
          usageLimit: d.usage_limit ?? null,
          oncePerCustomer: d.once_per_customer,
          startsAt: d.starts_at ? new Date(d.starts_at) : null,
          endsAt: d.ends_at ? new Date(d.ends_at) : null,
          active: d.active,
        })
        .onConflictDoNothing();
    }
    // Redirects are checked one by one; any the store can't use are left out.
    let redirectsAdded = 0;
    for (const r of data.redirects) {
      try {
        await addRedirect(tx as unknown as Db, shopId, r);
        redirectsAdded++;
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
      }
    }
    if (theme) {
      // Home sections that showed a collection point at its new copy, or at all products.
      const remap = (doc: typeof theme.draft) => ({
        ...doc,
        home: doc.home.map((s) => (s.type === "featured_products" && s.settings.collectionId ? { ...s, settings: { ...s.settings, collectionId: collectionIds.get(s.settings.collectionId) ?? null } } : s)),
      });
      const values = { template: data.theme!.template, draft: remap(theme.draft), published: remap(theme.published), publishedAt: new Date(), updatedAt: new Date() };
      await tx.insert(schema.themes).values({ shopId, ...values }).onConflictDoUpdate({ target: schema.themes.shopId, set: values });
    }
    const settings: Partial<typeof schema.shops.$inferInsert> = {};
    if (data.store.prices_include_tax !== undefined) settings.pricesIncludeTax = data.store.prices_include_tax;
    if (data.store.abandoned_cart_emails !== undefined) settings.abandonedCartEmails = data.store.abandoned_cart_emails;
    if (data.store.reviews_auto_publish !== undefined) settings.reviewsAutoPublish = data.store.reviews_auto_publish;
    if (data.store.presentment_currencies !== undefined) settings.presentmentCurrencies = [...new Set(data.store.presentment_currencies)];
    if (data.store.round_converted_prices !== undefined) settings.roundConvertedPrices = data.store.round_converted_prices;
    if (data.store.wholesale) {
      Object.assign(settings, {
        wholesaleEnabled: data.store.wholesale.enabled,
        wholesalePercentOff: data.store.wholesale.percent_off,
        wholesaleMinOrderMinor: data.store.wholesale.min_order_minor,
      });
    }
    if (Object.keys(settings).length) await tx.update(schema.shops).set(settings).where(eq(schema.shops.id, shopId));
    if (data.store.shipping_zones) {
      await tx.delete(schema.shippingZones).where(eq(schema.shippingZones.shopId, shopId));
      for (const zone of data.store.shipping_zones) {
        const [row] = await tx.insert(schema.shippingZones).values({ shopId, name: zone.name, countries: [...new Set(zone.countries)] }).returning();
        if (zone.rates.length) {
          await tx.insert(schema.shippingRates).values(
            zone.rates.map((r) => ({
              zoneId: row!.id,
              shopId,
              name: r.name,
              priceMinor: r.price_minor,
              freeOverMinor: r.free_over_minor,
              minDays: r.min_days,
              maxDays: r.min_days !== null && r.max_days !== null && r.max_days < r.min_days ? r.min_days : r.max_days,
            })),
          );
        }
      }
    }
    return {
      products: data.products.length,
      collections: data.collections.length,
      pages: data.pages.length,
      discountCodes: data.discount_codes.length,
      redirects: redirectsAdded,
      theme: !!theme,
      currencyDiffers: typeof data.store.currency === "string" && data.store.currency !== shop.currency,
    };
  });
}

/** One row per variant, for spreadsheets and other platforms. Prices are in major units. */
export async function productsCsv(db: Db, shopId: string) {
  const products = await db.query.products.findMany({ where: eq(schema.products.shopId, shopId), orderBy: asc(schema.products.createdAt) });
  const variants = products.length
    ? await db.query.variants.findMany({ where: inArray(schema.variants.productId, products.map((p) => p.id)), orderBy: asc(schema.variants.position) })
    : [];
  const major = (m: number | null) => (m === null ? null : (m / 100).toFixed(2));
  const header = ["Handle", "Title", "Status", "Variant", "SKU", "Price", "Compare at price", "Cost", "Stock", "Image URL", "Supplier link"];
  const rows = products.flatMap((p) =>
    variants
      .filter((v) => v.productId === p.id)
      .map((v) => [p.handle, p.title, p.status, v.title, v.sku, major(v.priceMinor), major(v.compareAtMinor), major(v.costMinor), v.stock, p.imageUrl, p.sourceUrl]),
  );
  return [header, ...rows].map((r) => r.map((c) => csvCell(c ?? null)).join(",")).join("\n") + "\n";
}

