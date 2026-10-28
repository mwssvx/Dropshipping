// Take your store with you: everything that makes up a store (products, collections, pages, theme,
// codes, bundles, settings, translations) as one JSON file that loads into a new store, plus products as CSV.
// Orders and customers stay out of the JSON file: they belong to the payments account.
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, SOLD_OUT_DISPLAY, TAG_RULE_KINDS, type Db, type FreeGift } from "@sf/db";
import { z } from "zod";
import { collectionRulesSchema } from "./collection-rules";
import { MAX_WEIGHT_GRAMS } from "./weight";
import { CONTENT_UNITS, MAX_CONTENTS } from "./unit-price";
import { countryCode } from "./customs";
import { parseBarcode } from "./barcode";
import { NotFoundError, UserError } from "./errors";
import { CURRENCIES } from "./currency";
import { setFreeGift } from "./free-gift";
import { csvCell } from "./payouts";
import { keptPhotoTexts, photoColumns, PHOTO_TEXT_MAX } from "./gallery";
import { addRedirect } from "./redirects";
import { parseTheme } from "./theme-doc";
import { listShippingZones } from "./shipping";
import { LANGUAGE_CODES, saveTranslation } from "./languages";
import { createBundle, MAX_BUNDLES } from "./bundles";
import { createTagRule, MAX_TAG_RULES } from "./tag-rules";
import { createSizeChart, MAX_SIZE_CHARTS } from "./size-charts";
import { MAX_SAVED_REPLIES, saveSavedReply } from "./saved-replies";
import { createSale, MAX_SALES } from "./sales";
import { createAddon, MAX_ADDONS, setAddonActive } from "./addons";
import { openPreorder } from "./preorders";
import { storePixels } from "./pixels";
import { parseVideo } from "./video";
import { detailsText, parseDetails } from "./product-details";
import { groupBy } from "./group";

export const EXPORT_FORMAT = "storefront-store";

function supplierOf(link: typeof schema.suppliers.$inferSelect | undefined, productRef: string | null) {
  if (!link) return null;
  return link.provider === "email"
    ? { provider: link.provider, product_ref: null, name: link.name, email: link.contactEmail }
    : { provider: link.provider, product_ref: productRef };
}

/** The store's free gift as a product handle and option name, or null. */
function freeGiftRef(gift: FreeGift | null, products: (typeof schema.products.$inferSelect)[], variants: Map<string, (typeof schema.variants.$inferSelect)[]>) {
  if (!gift) return null;
  for (const p of products) {
    const option = variants.get(p.id)?.find((v) => v.id === gift.variantId);
    if (option) return { product: p.handle, option: option.title, min_subtotal_minor: gift.minSubtotalMinor };
  }
  return null;
}

/** The backup supplier's listing, with its options keyed by our option titles. `variants` are the product's own. */
function backupOf(p: typeof schema.products.$inferSelect, links: (typeof schema.suppliers.$inferSelect)[], variants: (typeof schema.variants.$inferSelect)[]) {
  const link = p.backup && links.find((l) => l.id === p.backup!.supplierId);
  if (!p.backup || !link || link.provider === "email") return null;
  const options = variants.filter((v) => p.backup!.variants[v.id]).map((v) => [v.title, { ref: p.backup!.variants[v.id]!.ref, cost: p.backup!.variants[v.id]!.costMinor }]);
  return { provider: link.provider, url: p.backup.sourceUrl, product_ref: p.backup.productRef, variants: Object.fromEntries(options) };
}

export async function exportStore(db: Db, shopId: string, now = new Date()) {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  if (!shop) throw new NotFoundError("Store");
  const [products, collections, links, pages, theme, discounts, supplierRows, posts, redirectRows, translationRows, bundleRows, saleRows, addonRows, chartRows, replyRows, tagRuleRows] = await Promise.all([
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
    db.query.discounts.findMany({ where: and(eq(schema.discounts.shopId, shopId), eq(schema.discounts.source, "merchant")), orderBy: asc(schema.discounts.createdAt) }),
    db.query.suppliers.findMany({ where: eq(schema.suppliers.shopId, shopId) }),
    db.query.blogPosts.findMany({ where: eq(schema.blogPosts.shopId, shopId), orderBy: asc(schema.blogPosts.createdAt) }),
    db.query.redirects.findMany({ where: eq(schema.redirects.shopId, shopId), orderBy: asc(schema.redirects.fromPath) }),
    db.query.translations.findMany({ where: eq(schema.translations.shopId, shopId), orderBy: [asc(schema.translations.language), asc(schema.translations.kind)] }),
    db.query.bundles.findMany({ where: eq(schema.bundles.shopId, shopId), orderBy: asc(schema.bundles.createdAt) }),
    db.query.sales.findMany({ where: eq(schema.sales.shopId, shopId), orderBy: asc(schema.sales.startsAt) }),
    db.query.checkoutAddons.findMany({ where: eq(schema.checkoutAddons.shopId, shopId), orderBy: asc(schema.checkoutAddons.createdAt) }),
    db.query.sizeCharts.findMany({ where: eq(schema.sizeCharts.shopId, shopId), orderBy: asc(schema.sizeCharts.createdAt) }),
    db.query.savedReplies.findMany({ where: eq(schema.savedReplies.shopId, shopId), orderBy: asc(schema.savedReplies.title) }),
    db.query.customerTagRules.findMany({ where: eq(schema.customerTagRules.shopId, shopId), orderBy: asc(schema.customerTagRules.createdAt) }),
  ]);
  // Variants of every product in the store, picked by the store rather than a list of ids, which
  // Postgres caps at 65,535 values.
  const variants = products.length
    ? groupBy(await db.query.variants.findMany({ where: inArray(schema.variants.productId, db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.shopId, shopId))), orderBy: asc(schema.variants.position) }), (v) => v.productId)
    : new Map<string, (typeof schema.variants.$inferSelect)[]>();
  const handleOf = new Map(products.map((p) => [p.id, p.handle]));
  const handleByKind: Record<"product" | "collection" | "page", Map<string, string>> = {
    product: handleOf,
    collection: new Map(collections.map((c) => [c.id, c.handle])),
    page: new Map(pages.map((p) => [p.id, p.handle])),
  };
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
      checkout_phone: shop.checkoutPhone,
      abandoned_cart_offer: shop.abandonedCartOffer ? { percent_off: shop.abandonedCartOffer.percentOff } : null,
      delivery_protection: shop.deliveryProtection ? { percent: shop.deliveryProtection.percent, min_minor: shop.deliveryProtection.minMinor } : null,
      packing_slip_note: shop.packingSlipNote,
      restock_alert_at: shop.restockAlertAt,
      local_pickup: shop.localPickup,
      local_delivery_area: shop.localDeliveryArea,
      gift_wrap: shop.giftWrap,
      min_order_minor: shop.minOrderMinor,
      tipping: shop.tipping,
      ship_cutoff: shop.shipCutoff,
      survey: shop.survey,
      price_watch: { min_margin_percent: shop.minMarginPercent, auto_reprice: shop.autoReprice },
      reviews_auto_publish: shop.reviewsAutoPublish,
      presentment_currencies: shop.presentmentCurrencies,
      round_converted_prices: shop.roundConvertedPrices,
      languages: shop.languages,
      rewards: { enabled: shop.rewardsEnabled, earn_rate: shop.rewardsEarnRate, value_minor: shop.rewardsValueMinor },
      // The number series stays with the store it was used in.
      invoices: { legal_name: shop.invoiceLegalName, address: shop.invoiceAddress, prefix: shop.invoicePrefix, footer: shop.invoiceFooter },
      wholesale: { enabled: shop.wholesaleEnabled, percent_off: shop.wholesalePercentOff, min_order_minor: shop.wholesaleMinOrderMinor },
      welcome_offer: shop.welcomeOffer ? { percent_off: shop.welcomeOffer.percentOff, min_subtotal: shop.welcomeOffer.minSubtotalMinor, days: shop.welcomeOffer.days } : null,
      winback_offer: shop.winbackOffer ? { after_days: shop.winbackOffer.afterDays, percent_off: shop.winbackOffer.percentOff, days: shop.winbackOffer.days } : null,
      after_checkout_offer: shop.postPurchaseOffer && handleOf.get(shop.postPurchaseOffer.productId)
        ? { product: handleOf.get(shop.postPurchaseOffer.productId)!, percent_off: shop.postPurchaseOffer.percentOff, active: shop.postPurchaseOffer.active }
        : null,
      subscribe_and_save: shop.subscriptionOffer ? { percent_off: shop.subscriptionOffer.percentOff, active: shop.subscriptionOffer.active } : null,
      delivery_estimates: { enabled: shop.deliveryEstimates, processing_days: shop.processingDays },
      low_stock_note: shop.lowStockNote,
      badges: { sale: shop.productBadges.sale, sold_out: shop.productBadges.soldOut, new_days: shop.productBadges.newDays },
      sold_out_products: shop.soldOutProducts,
      lowest_price_note: shop.lowestPriceNote,
      search_fixes: shop.searchFixes,
      ad_tracking: { meta_pixel: shop.adPixels?.meta ?? null, tiktok_pixel: shop.adPixels?.tiktok ?? null, google_tag: shop.adPixels?.google ?? null, ask_consent: shop.cookieConsent },
      hold_risky_orders: shop.holdRiskyOrders,
      refer_a_friend: shop.referralProgram ? { friend_percent_off: shop.referralProgram.friendPercentOff, reward: shop.referralProgram.rewardMinor, min_subtotal: shop.referralProgram.minSubtotalMinor } : null,
      // Missing means the built-in default rate.
      shipping_zones: shipping.isDefault
        ? undefined
        : shipping.zones.map((z) => ({
            name: z.name,
            countries: z.countries,
            rates: z.rates.map((r) => ({ name: r.name, price_minor: r.priceMinor, free_over_minor: r.freeOverMinor, min_days: r.minDays, max_days: r.maxDays, min_weight_grams: r.minWeightGrams, max_weight_grams: r.maxWeightGrams })),
          })),
    },
    theme: theme ? { template: theme.template, draft: theme.draft, published: theme.published } : null,
    products: products.map((p) => ({
      handle: p.handle,
      title: p.title,
      description_html: p.descriptionHtml,
      image_url: p.imageUrl,
      images: p.images,
      photo_descriptions: p.imageAlts,
      status: p.status,
      source_url: p.sourceUrl,
      supplier: p.supplierId ? supplierOf(supplierRows.find((s) => s.id === p.supplierId), p.supplierProductRef) : null,
      backup: backupOf(p, supplierRows, variants.get(p.id) ?? []),
      goes_well_with: p.upsellProductId ? (handleOf.get(p.upsellProductId) ?? null) : null,
      quantity_breaks: p.quantityBreaks.map((t) => ({ min_qty: t.minQty, percent_off: t.percentOff })),
      personalization: p.personalization.map((f) => ({ label: f.label, required: f.required, max_length: f.maxLength })),
      preorder: p.preorder ? { ships_by: p.preorder.shipsBy, limit: p.preorder.limit } : null,
      search_listing: p.seoTitle || p.seoDescription ? { title: p.seoTitle, description: p.seoDescription } : null,
      purchase_limit: p.purchaseLimit ? { min: p.purchaseLimit.min, max: p.purchaseLimit.max, per_customer: p.purchaseLimit.perCustomer } : null,
      video_url: p.videoUrl,
      hs_code: p.hsCode,
      origin_country: p.originCountry,
      min_age: p.minAge,
      reorder_days: p.reorderDays,
      blocked_countries: p.blockedCountries,
      swatches: Object.keys(p.swatches).length ? p.swatches : undefined,
      details: p.details.length ? p.details : undefined,
      badge: p.badge,
      tags: p.tags.length ? p.tags : undefined,
      gift_card: p.giftCard,
      variants: (variants.get(p.id) ?? [])
        .map((v) => ({
          title: v.title,
          options: v.options,
          sku: v.sku,
          supplier_ref: v.supplierVariantRef,
          price: v.priceMinor,
          compare_at_price: v.compareAtMinor,
          cost: v.costMinor,
          stock: v.stock,
          weight_grams: v.weightGrams,
          contents: v.contents,
          barcode: v.barcode,
          location: v.location,
          ship_days_min: v.shipDaysMin,
          ship_days_max: v.shipDaysMax,
          image_url: v.imageUrl,
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
      // An automatic collection carries its rules; its products follow from them.
      ...(c.rules ? { rules: c.rules } : {}),
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
      customer_tag: d.customerTag,
      starts_at: iso(d.startsAt),
      ends_at: iso(d.endsAt),
      active: d.active,
      ...(d.productIds.length ? { products: d.productIds.map((id) => handleOf.get(id)).filter((h): h is string => !!h) } : {}),
      automatic: d.automatic,
      ...(d.kind === "bxgy" ? { buy_qty: d.buyQty, get_qty: d.getQty } : {}),
    })),
    redirects: redirectRows.map((r) => ({ from: r.fromPath, to: r.toPath })),
    size_charts: chartRows.map((c) => ({
      name: c.name,
      unit: c.unit,
      columns: c.columns,
      rows: c.rows,
      note: c.note,
      products: c.productIds.map((id) => handleOf.get(id)).filter((h): h is string => !!h),
      collections: c.collectionIds.map((id) => handleByKind.collection.get(id)).filter((h): h is string => !!h),
      published: c.published,
    })),
    saved_replies: replyRows.map((r) => ({ title: r.title, body: r.body })),
    // The rules only; the new store tags its own customers.
    tag_rules: tagRuleRows.flatMap((r) => {
      const product = r.productId ? handleOf.get(r.productId) : null;
      if (r.kind === "bought" && !product) return [];
      return [{ tag: r.tag, kind: r.kind, threshold: r.threshold, ...(product ? { product } : {}) }];
    }),
    bundles: bundleRows.map((b) => ({ title: b.title, products: b.productIds.map((id) => handleOf.get(id)).filter((h): h is string => !!h), percent_off: b.percentOff, active: b.active })),
    checkout_addons: addonRows.flatMap((a) => {
      const product = handleOf.get(a.productId);
      return product ? [{ product, percent_off: a.percentOff, pitch: a.pitch, active: a.active }] : [];
    }),
    // The free gift by product handle and option name, since ids change in the new store.
    free_gift: freeGiftRef(shop.freeGift, products, variants),
    // Sales that haven't ended; collections and products by handle.
    sales: saleRows
      .filter((x) => !x.endsAt || x.endsAt > new Date())
      .map((x) => ({
        title: x.title,
        percent_off: x.percentOff,
        scope: x.scope,
        collection: x.collectionId ? (handleByKind.collection.get(x.collectionId) ?? null) : null,
        products: x.productIds.map((id) => handleOf.get(id)).filter((h): h is string => !!h),
        starts_at: x.startsAt.toISOString(),
        ends_at: iso(x.endsAt),
        countdown: x.countdown,
      })),
    // Products, collections and pages are matched by handle; the theme has none.
    translations: translationRows.flatMap((t) => {
      const ref = t.kind === "theme" ? null : handleByKind[t.kind].get(t.refId);
      return ref === undefined ? [] : [{ language: t.language, kind: t.kind, ref, fields: t.fields }];
    }),
  };
}

export type StoreExport = Awaited<ReturnType<typeof exportStore>>;

const handle = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "A handle in the file isn't valid.");
const money = z.number().int().min(0).max(100_000_000);
const str = (max: number) => z.string().max(max);
const date = z.string().datetime().nullable().optional();

const importSchema = z.object({
  format: z.literal(EXPORT_FORMAT, { error: "This isn't a store file from us." }),
  version: z.literal(1, { error: "This store file is from a newer version. Update and try again." }),
  store: z
    .object({
      prices_include_tax: z.boolean().optional(),
      abandoned_cart_emails: z.boolean().optional(),
      checkout_phone: z.enum(["off", "optional", "required"]).optional(),
      abandoned_cart_offer: z.object({ percent_off: z.number().int().min(5).max(50) }).nullable().optional(),
      delivery_protection: z.object({ percent: z.number().min(0.5).max(10), min_minor: z.number().int().min(0).max(10_000) }).nullable().optional(),
      packing_slip_note: z.string().max(500).nullable().optional(),
      restock_alert_at: z.number().int().min(0).max(1000).optional(),
      gift_wrap: z.object({ priceMinor: z.number().int().min(0).max(10_000), note: z.string().max(120).nullable() }).nullable().optional(),
      min_order_minor: z.number().int().min(0).max(100_000).optional(),
      ship_cutoff: z.object({ hour: z.number().int().min(1).max(23), timeZone: z.string().max(60), weekends: z.boolean() }).nullable().optional(),
      tipping: z.object({ percents: z.array(z.number().int().min(1).max(30)).min(1).max(3), note: z.string().max(120).nullable() }).nullable().optional(),
      survey: z.object({ question: z.string().max(120), options: z.array(z.string().max(40)).min(2).max(8), other: z.boolean() }).nullable().optional(),
      local_delivery_area: z
        .object({ postalPrefixes: z.array(z.string().regex(/^[A-Z0-9]{1,10}$/)).min(1).max(200), priceMinor: z.number().int().min(0).max(100_000), freeOverMinor: z.number().int().positive().nullable(), note: z.string().max(200).nullable() })
        .nullable()
        .optional(),
      local_pickup: z.object({ address: z.string().trim().min(1).max(300), instructions: z.string().max(500).nullable() }).nullable().optional(),
      price_watch: z.object({ min_margin_percent: z.number().int().min(0).max(90), auto_reprice: z.boolean() }).optional(),
      reviews_auto_publish: z.boolean().optional(),
      presentment_currencies: z.array(z.enum(CURRENCIES)).max(CURRENCIES.length).optional(),
      round_converted_prices: z.boolean().optional(),
      languages: z.array(z.enum(LANGUAGE_CODES as [string, ...string[]])).max(LANGUAGE_CODES.length).optional(),
      welcome_offer: z.object({ percent_off: z.number().int().min(5).max(50), min_subtotal: z.number().int().min(0), days: z.number().int().min(7).max(90) }).nullable().optional(),
      winback_offer: z.object({ after_days: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(180)]), percent_off: z.number().int().min(5).max(50), days: z.number().int().min(7).max(60) }).nullable().optional(),
      after_checkout_offer: z.object({ product: handle, percent_off: z.number().int().min(0).max(50), active: z.boolean() }).nullable().optional(),
      subscribe_and_save: z.object({ percent_off: z.number().int().min(0).max(30), active: z.boolean() }).nullable().optional(),
      delivery_estimates: z.object({ enabled: z.boolean(), processing_days: z.number().int().min(0).max(14) }).optional(),
      low_stock_note: z.number().int().min(0).max(50).optional(),
      badges: z.object({ sale: z.boolean(), sold_out: z.boolean(), new_days: z.number().int().min(0).max(90) }).optional(),
      sold_out_products: z.enum(SOLD_OUT_DISPLAY).optional(),
      lowest_price_note: z.enum(["eu", "everyone", "off"]).optional(),
      search_fixes: z.array(z.object({ from: str(80).min(2), to: str(80).min(1) })).max(100).optional(),
      ad_tracking: z
        .object({ meta_pixel: str(40).nullable(), tiktok_pixel: str(40).nullable(), google_tag: str(40).nullable(), ask_consent: z.enum(["everyone", "eu_uk"]) })
        .optional(),
      hold_risky_orders: z.enum(["off", "medium", "high"]).optional(),
      refer_a_friend: z.object({ friend_percent_off: z.number().int().min(5).max(50), reward: z.number().int().min(100).max(10_000), min_subtotal: z.number().int().min(0) }).nullable().optional(),
      rewards: z.object({ enabled: z.boolean(), earn_rate: z.number().int().min(1).max(100), value_minor: z.number().int().min(1).max(10_000) }).optional(),
      invoices: z
        .object({ legal_name: z.string().max(120).nullable(), address: z.string().max(400).nullable(), prefix: z.string().max(12).regex(/^[A-Za-z0-9\-/_.]*$/), footer: z.string().max(500).nullable() })
        .optional(),
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
                  min_weight_grams: z.number().int().min(0).max(MAX_WEIGHT_GRAMS).nullable().optional(),
                  max_weight_grams: z.number().int().min(1).max(MAX_WEIGHT_GRAMS).nullable().optional(),
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
        photo_descriptions: z.record(z.string().max(2000), str(PHOTO_TEXT_MAX)).optional(),
        status: z.enum(["draft", "active", "archived"]),
        source_url: str(2000).nullable().optional(),
        supplier: z
          .object({
            provider: z.enum(["fake", "cj", "aliexpress", "email"]).nullable(),
            product_ref: str(200).nullable(),
            // Own suppliers only.
            name: str(100).nullable().optional(),
            email: z.string().email().max(320).nullable().optional(),
          })
          .nullable()
          .optional(),
        backup: z
          .object({
            provider: z.enum(["fake", "cj", "aliexpress"]),
            url: str(2000),
            product_ref: str(200),
            variants: z.record(str(200), z.object({ ref: str(200), cost: money })),
          })
          .nullable()
          .optional(),
        goes_well_with: handle.nullable().optional(),
        gift_card: z.boolean().optional(),
        quantity_breaks: z
          .array(z.object({ min_qty: z.number().int().min(2).max(99), percent_off: z.number().int().min(1).max(80) }))
          .max(3)
          .optional(),
        personalization: z
          .array(z.object({ label: str(40), required: z.boolean(), max_length: z.number().int().min(1).max(200) }))
          .max(3)
          .optional(),
        search_listing: z.object({ title: str(70).nullable(), description: str(160).nullable() }).nullable().optional(),
        video_url: z.string().max(2000).nullable().optional(),
        details: z.array(z.object({ label: z.string().max(200), value: z.string().max(1000) })).max(100).optional(),
        badge: z.string().max(20).nullable().optional(),
        tags: z.array(z.string().max(30)).max(20).optional(),
        hs_code: z.string().max(20).nullable().optional(),
        min_age: z.number().int().nullable().optional(),
        reorder_days: z.number().int().nullable().optional(),
        blocked_countries: z.array(z.string().length(2)).max(60).optional(),
        swatches: z.record(z.string().max(200), z.string()).optional(),
        origin_country: z.string().max(10).nullable().optional(),
        purchase_limit: z
          .object({ min: z.number().int().min(2).max(99).nullable(), max: z.number().int().min(1).max(99).nullable(), per_customer: z.number().int().min(1).max(999).nullable() })
          .nullable()
          .optional(),
        preorder: z
          .object({ ships_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), limit: z.number().int().min(1).max(10_000).nullable() })
          .nullable()
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
              weight_grams: z.number().int().min(1).max(MAX_WEIGHT_GRAMS).nullable().optional(),
              contents: z.object({ amount: z.number().positive().max(MAX_CONTENTS), unit: z.enum(CONTENT_UNITS) }).nullable().optional(),
              barcode: z.string().max(100).nullable().optional(),
              location: z.string().max(100).nullable().optional(),
              ship_days_min: z.number().int().min(0).max(365).nullable().optional(),
              ship_days_max: z.number().int().min(0).max(365).nullable().optional(),
              image_url: z.string().max(2000).nullable().optional(),
            }),
          )
          .min(1, "Every product needs at least one variant.")
          .max(100),
      }),
    )
    .max(5000, "The file has more than 5,000 products."),
  collections: z
    .array(z.object({ id: z.string().uuid().optional(), handle, title: str(200).min(1), description: str(5000).default(""), image_url: str(2000).nullable().optional(), products: z.array(handle).max(5000), rules: collectionRulesSchema.nullable().optional() }))
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
  bundles: z
    .array(z.object({ title: str(80), products: z.array(handle).max(4), percent_off: z.number().int(), active: z.boolean().default(true) }))
    .max(MAX_BUNDLES)
    .default([]),
  tag_rules: z
    .array(z.object({ tag: str(30), kind: z.enum(TAG_RULE_KINDS), threshold: z.number().int(), product: handle.optional() }))
    .max(MAX_TAG_RULES)
    .default([]),
  size_charts: z
    .array(
      z.object({
        name: str(60),
        unit: z.enum(["cm", "in"]),
        columns: z.array(z.string().max(30)).max(8),
        rows: z.array(z.array(z.string().max(30)).max(8)).max(30),
        note: z.string().max(500).nullable(),
        products: z.array(handle).max(500),
        collections: z.array(handle).max(100),
        published: z.boolean().default(true),
      }),
    )
    .max(MAX_SIZE_CHARTS)
    .default([]),
  saved_replies: z
    .array(z.object({ title: str(60), body: z.string().max(2000) }))
    .max(MAX_SAVED_REPLIES)
    .default([]),
  checkout_addons: z
    .array(z.object({ product: handle, percent_off: z.number().int(), pitch: z.string().max(120).nullable(), active: z.boolean().default(true) }))
    .max(MAX_ADDONS)
    .default([]),
  free_gift: z.object({ product: handle, option: z.string().max(255), min_subtotal_minor: z.number().int() }).nullable().optional(),
  sales: z
    .array(
      z.object({
        title: str(60),
        percent_off: z.number().int(),
        scope: z.enum(["all", "collection", "products"]),
        collection: handle.nullable(),
        products: z.array(handle).max(200),
        starts_at: z.string().datetime({ offset: true }),
        ends_at: z.string().datetime({ offset: true }).nullable(),
        countdown: z.boolean().optional(),
      }),
    )
    .max(MAX_SALES)
    .default([]),
  translations: z
    .array(
      z.object({
        language: str(5),
        kind: z.enum(["product", "collection", "page", "theme"]),
        ref: handle.nullable(),
        fields: z.record(str(200_000), str(50_000)),
      }),
    )
    .max(5000)
    .default([]),
  discount_codes: z
    .array(
      z.object({
        code: z.string().regex(/^[A-Z0-9_-]{3,30}$/),
        kind: z.enum(["percent", "amount", "free_shipping", "bxgy"]),
        value: z.number().int().min(0),
        buy_qty: z.number().int().min(1).max(20).nullable().optional(),
        get_qty: z.number().int().min(1).max(20).nullable().optional(),
        products: z.array(z.string()).max(100).default([]),
        automatic: z.boolean().default(false),
        min_subtotal: money.default(0),
        usage_limit: z.number().int().min(1).nullable().optional(),
        once_per_customer: z.boolean().default(false),
        customer_tag: z.string().trim().toLowerCase().min(1).max(30).nullable().optional(),
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
      const { images } = photoColumns(x.images?.length ? x.images : x.image_url ? [x.image_url] : []);
      const [row] = await tx
        .insert(schema.products)
        .values({
          shopId,
          handle: x.handle,
          title: x.title,
          descriptionHtml: x.description_html,
          images,
          imageUrl: images[0] ?? null,
          imageAlts: keptPhotoTexts(x.photo_descriptions, images),
          status: x.status,
          sourceUrl: x.source_url ?? null,
          supplierId: key ? supplierIds.get(key)! : null,
          supplierProductRef: provider ? (x.supplier?.product_ref ?? null) : null,
          quantityBreaks: (x.quantity_breaks ?? []).map((t) => ({ minQty: t.min_qty, percentOff: t.percent_off })).sort((a, b) => a.minQty - b.minQty),
          giftCard: x.gift_card ?? false,
          personalization: (x.personalization ?? []).map((f, i) => ({ id: `f${i + 1}`, label: f.label, required: f.required, maxLength: f.max_length })),
          seoTitle: x.search_listing?.title || null,
          seoDescription: x.search_listing?.description || null,
          purchaseLimit: x.purchase_limit ? { min: x.purchase_limit.min, max: x.purchase_limit.max, perCustomer: x.purchase_limit.per_customer } : null,
          videoUrl: parseVideo(x.video_url) ? x.video_url!.trim() : null,
          // Kept only when they'd save here.
          hsCode: /^\d{6,10}$/.test(x.hs_code ?? "") ? x.hs_code! : null,
          originCountry: countryCode(x.origin_country),
          minAge: x.min_age != null && x.min_age >= 13 && x.min_age <= 25 ? x.min_age : null,
          reorderDays: x.reorder_days != null && x.reorder_days >= 7 && x.reorder_days <= 180 ? x.reorder_days : null,
          blockedCountries: x.blocked_countries ?? [],
          swatches: Object.fromEntries(Object.entries(x.swatches ?? {}).filter(([, c]) => /^#[0-9a-f]{6}$/i.test(c)).map(([v, c]) => [v, c.toLowerCase()])),
          // Read like the merchant's own text, so lines that wouldn't save here are dropped.
          details: x.details ? parseDetails(detailsText(x.details)) : [],
          badge: x.badge?.trim() || null,
          tags: [...new Set((x.tags ?? []).map((t) => t.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))],
          // A pre-order whose date has passed isn't brought over.
          preorder: x.preorder && openPreorder({ preorder: { shipsBy: x.preorder.ships_by, limit: x.preorder.limit } }) ? { shipsBy: x.preorder.ships_by, limit: x.preorder.limit } : null,
        })
        .returning({ id: schema.products.id });
      productIds.set(x.handle, row!.id);
      const inserted = await tx.insert(schema.variants).values(
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
          weightGrams: v.weight_grams ?? null,
          contents: v.contents ?? null,
          barcode: (() => {
            try {
              return parseBarcode(v.barcode);
            } catch {
              return null;
            }
          })(),
          location: v.location?.trim().slice(0, 40) || null,
          shipDaysMin: v.ship_days_min ?? null,
          shipDaysMax: v.ship_days_max ?? null,
          position: i,
          // Only one of the product's own photos.
          imageUrl: v.image_url && images.includes(v.image_url) ? v.image_url : null,
        })),
      ).returning({ id: schema.variants.id, title: schema.variants.title });
      // A backup only makes sense next to a supplier listing; its stock is read at the next check.
      if (x.backup && provider && x.source_url) {
        const [link] = await tx
          .insert(schema.suppliers)
          .values({ shopId, provider: x.backup.provider })
          .onConflictDoUpdate({ target: [schema.suppliers.shopId, schema.suppliers.provider, schema.suppliers.contactEmail], set: { status: "connected" } })
          .returning({ id: schema.suppliers.id });
        const matched = inserted.flatMap((v) => (x.backup!.variants[v.title] ? [[v.id, { ref: x.backup!.variants[v.title]!.ref, costMinor: x.backup!.variants[v.title]!.cost, stock: 0 }] as const] : []));
        if (matched.length) {
          await tx
            .update(schema.products)
            .set({ backup: { supplierId: link!.id, sourceUrl: x.backup.url, productRef: x.backup.product_ref, variants: Object.fromEntries(matched), checkedAt: new Date(0).toISOString() } })
            .where(eq(schema.products.id, row!.id));
        }
      }
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
        .values({ shopId, handle: x.handle, title: x.title, description: x.description, imageUrl: x.image_url ?? null, rules: x.rules ?? null })
        .returning({ id: schema.collections.id });
      if (x.id) collectionIds.set(x.id, row!.id);
      if (x.rules) continue;
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
      // A buy X get Y offer without its quantities can't work, so it's left out.
      const bxgy = d.kind === "bxgy";
      const scope = d.products.map((h) => productIds.get(h)).filter((id): id is string => !!id);
      if (bxgy && (!d.buy_qty || !d.get_qty)) continue;
      // Nor one whose products aren't in the file: it would widen to every product.
      if (d.kind !== "free_shipping" && d.products.length && !scope.length) continue;
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
          customerTag: d.customer_tag ?? null,
          startsAt: d.starts_at ? new Date(d.starts_at) : null,
          endsAt: d.ends_at ? new Date(d.ends_at) : null,
          active: d.active,
          buyQty: bxgy ? d.buy_qty! : null,
          getQty: bxgy ? d.get_qty! : null,
          productIds: d.kind === "free_shipping" ? [] : scope,
          // Automatic money off is for the whole order and everyone, as createDiscount allows.
          automatic: d.automatic && (bxgy || ((d.kind === "percent" || d.kind === "amount") && d.min_subtotal > 0 && !scope.length && !d.customer_tag)),
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
    if (data.store.checkout_phone) settings.checkoutPhone = data.store.checkout_phone;
    if (data.store.abandoned_cart_offer !== undefined) settings.abandonedCartOffer = data.store.abandoned_cart_offer && { percentOff: data.store.abandoned_cart_offer.percent_off };
    if (data.store.delivery_protection !== undefined) settings.deliveryProtection = data.store.delivery_protection && { percent: data.store.delivery_protection.percent, minMinor: data.store.delivery_protection.min_minor };
    if (data.store.packing_slip_note !== undefined) settings.packingSlipNote = data.store.packing_slip_note;
    if (data.store.restock_alert_at !== undefined) settings.restockAlertAt = data.store.restock_alert_at;
    if (data.store.local_pickup !== undefined) settings.localPickup = data.store.local_pickup;
    if (data.store.local_delivery_area !== undefined) settings.localDeliveryArea = data.store.local_delivery_area;
    if (data.store.gift_wrap !== undefined) settings.giftWrap = data.store.gift_wrap;
    if (data.store.min_order_minor !== undefined) settings.minOrderMinor = data.store.min_order_minor;
    if (data.store.tipping !== undefined) settings.tipping = data.store.tipping;
    if (data.store.ship_cutoff !== undefined) settings.shipCutoff = data.store.ship_cutoff;
    if (data.store.survey !== undefined) settings.survey = data.store.survey;
    if (data.store.price_watch) {
      settings.minMarginPercent = data.store.price_watch.min_margin_percent;
      settings.autoReprice = data.store.price_watch.auto_reprice;
    }
    if (data.store.reviews_auto_publish !== undefined) settings.reviewsAutoPublish = data.store.reviews_auto_publish;
    if (data.store.presentment_currencies !== undefined) settings.presentmentCurrencies = [...new Set(data.store.presentment_currencies)];
    if (data.store.round_converted_prices !== undefined) settings.roundConvertedPrices = data.store.round_converted_prices;
    if (data.store.hold_risky_orders) settings.holdRiskyOrders = data.store.hold_risky_orders;
    if (data.store.refer_a_friend !== undefined) {
      const r = data.store.refer_a_friend;
      settings.referralProgram = r ? { friendPercentOff: r.friend_percent_off, rewardMinor: r.reward, minSubtotalMinor: r.min_subtotal } : null;
    }
    if (data.store.winback_offer !== undefined) {
      const w = data.store.winback_offer;
      settings.winbackOffer = w ? { afterDays: w.after_days, percentOff: w.percent_off, days: w.days } : null;
    }
    if (data.store.welcome_offer !== undefined) {
      const w = data.store.welcome_offer;
      settings.welcomeOffer = w ? { percentOff: w.percent_off, minSubtotalMinor: w.min_subtotal, days: w.days } : null;
    }
    if (data.store.after_checkout_offer !== undefined) {
      const o = data.store.after_checkout_offer;
      const productId = o ? productIds.get(o.product) : undefined;
      settings.postPurchaseOffer = o && productId ? { productId, percentOff: o.percent_off, active: o.active } : null;
    }
    if (data.store.delivery_estimates) {
      Object.assign(settings, { deliveryEstimates: data.store.delivery_estimates.enabled, processingDays: data.store.delivery_estimates.processing_days });
    }
    if (data.store.low_stock_note !== undefined) settings.lowStockNote = data.store.low_stock_note;
    if (data.store.sold_out_products) settings.soldOutProducts = data.store.sold_out_products;
    if (data.store.lowest_price_note) settings.lowestPriceNote = data.store.lowest_price_note;
    if (data.store.search_fixes) settings.searchFixes = data.store.search_fixes.map((f) => ({ from: f.from.toLowerCase().trim(), to: f.to.toLowerCase().trim() }));
    if (data.store.badges) settings.productBadges = { sale: data.store.badges.sale, soldOut: data.store.badges.sold_out, newDays: data.store.badges.new_days };
    if (data.store.ad_tracking) {
      // Only IDs in the platforms' formats come in; anything else is left off.
      const a = data.store.ad_tracking;
      settings.adPixels = storePixels({ adPixels: { meta: a.meta_pixel, tiktok: a.tiktok_pixel, google: a.google_tag } });
      settings.cookieConsent = a.ask_consent;
    }
    if (data.store.subscribe_and_save !== undefined) {
      const o = data.store.subscribe_and_save;
      settings.subscriptionOffer = o ? { percentOff: o.percent_off, active: o.active } : null;
    }
    if (data.store.rewards) {
      Object.assign(settings, { rewardsEnabled: data.store.rewards.enabled, rewardsEarnRate: data.store.rewards.earn_rate, rewardsValueMinor: data.store.rewards.value_minor });
    }
    if (data.store.invoices) {
      const inv = data.store.invoices;
      Object.assign(settings, { invoiceLegalName: inv.legal_name, invoiceAddress: inv.address, invoicePrefix: inv.prefix, invoiceFooter: inv.footer });
    }
    if (data.store.languages !== undefined) settings.languages = LANGUAGE_CODES.filter((l) => data.store.languages!.includes(l));
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
              // A range that doesn't make sense comes in without its upper limit.
              minWeightGrams: r.min_weight_grams || null,
              maxWeightGrams: r.max_weight_grams && (!r.min_weight_grams || r.max_weight_grams > r.min_weight_grams) ? r.max_weight_grams : null,
            })),
          );
        }
      }
    }
    // Bundles go through the same checks as the Bundles page; any that don't fit are left out.
    let bundlesAdded = 0;
    for (const b of data.bundles) {
      try {
        await createBundle(tx as unknown as Db, shopId, { title: b.title, productIds: b.products.map((h) => productIds.get(h)!).filter(Boolean), percentOff: b.percent_off, active: b.active });
        bundlesAdded++;
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
      }
    }
    // Tag rules go through the same checks as the Customers page; any that don't fit are left out.
    let tagRulesAdded = 0;
    for (const r of data.tag_rules) {
      try {
        const input = r.kind === "bought" ? { kind: r.kind, tag: r.tag, productId: (r.product && productIds.get(r.product)) || "" } : { kind: r.kind, tag: r.tag, threshold: r.threshold };
        await createTagRule(tx as unknown as Db, shopId, input, { apply: false });
        tagRulesAdded++;
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
      }
    }
    // Size charts go through the same checks as the Size charts page; any that don't fit are left out.
    let chartsAdded = 0;
    if (data.size_charts.length) {
      const collectionByHandle = new Map((await tx.query.collections.findMany({ where: eq(schema.collections.shopId, shopId), columns: { id: true, handle: true } })).map((x) => [x.handle, x.id]));
      for (const c of data.size_charts) {
        try {
          await createSizeChart(tx as unknown as Db, shopId, {
            ...c,
            productIds: c.products.map((h) => productIds.get(h)!).filter(Boolean),
            collectionIds: c.collections.map((h) => collectionByHandle.get(h)!).filter(Boolean),
          });
          chartsAdded++;
        } catch (e) {
          if (!(e instanceof UserError)) throw e;
        }
      }
    }
    // Saved replies go through the same checks as the Saved replies page; a name the store already uses is left out.
    let repliesAdded = 0;
    for (const r of data.saved_replies) {
      try {
        await saveSavedReply(tx as unknown as Db, shopId, r);
        repliesAdded++;
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
      }
    }
    let addonsAdded = 0;
    for (const a of data.checkout_addons) {
      const productId = productIds.get(a.product);
      if (!productId) continue;
      try {
        const row = await createAddon(tx as unknown as Db, shopId, { productId, percentOff: a.percent_off, pitch: a.pitch ?? "" });
        if (!a.active) await setAddonActive(tx as unknown as Db, shopId, row.id, false);
        addonsAdded++;
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
      }
    }
    if (data.free_gift) {
      const productId = productIds.get(data.free_gift.product);
      const option = productId
        ? await tx.query.variants.findFirst({ where: and(eq(schema.variants.productId, productId), eq(schema.variants.title, data.free_gift.option)), columns: { id: true } })
        : undefined;
      if (option) {
        try {
          await setFreeGift(tx as unknown as Db, shopId, { variantId: option.id, minSubtotalMinor: data.free_gift.min_subtotal_minor });
        } catch (e) {
          if (!(e instanceof UserError)) throw e;
        }
      }
    }
    // Sales too; any that don't fit (or ended since the file was made) are left out.
    let salesAdded = 0;
    if (data.sales.length) {
      const collectionByHandle = new Map((await tx.query.collections.findMany({ where: eq(schema.collections.shopId, shopId), columns: { id: true, handle: true } })).map((x) => [x.handle, x.id]));
      for (const x of data.sales) {
        try {
          await createSale(tx as unknown as Db, shopId, {
            title: x.title,
            percentOff: x.percent_off,
            scope: x.scope,
            collectionId: x.collection ? (collectionByHandle.get(x.collection) ?? null) : null,
            productIds: x.products.map((h) => productIds.get(h)!).filter(Boolean),
            startsAt: new Date(x.starts_at),
            endsAt: x.ends_at ? new Date(x.ends_at) : null,
            countdown: !!x.countdown && !!x.ends_at,
          });
          salesAdded++;
        } catch (e) {
          if (!(e instanceof UserError)) throw e;
        }
      }
    }
    // Translations go through the same checks as the editor; any that don't fit are left out.
    let translationsAdded = 0;
    if (data.translations.length) {
      const fresh = (await tx.query.shops.findFirst({ where: eq(schema.shops.id, shopId) }))!;
      const pageIds = new Map((await tx.query.pages.findMany({ where: eq(schema.pages.shopId, shopId), columns: { id: true, handle: true } })).map((x) => [x.handle, x.id]));
      const collectionByHandle = new Map((await tx.query.collections.findMany({ where: eq(schema.collections.shopId, shopId), columns: { id: true, handle: true } })).map((x) => [x.handle, x.id]));
      const idOf = { product: productIds, collection: collectionByHandle, page: pageIds };
      for (const t of data.translations) {
        const refId = t.kind === "theme" ? shopId : t.ref ? idOf[t.kind].get(t.ref) : undefined;
        if (!refId) continue;
        try {
          if ((await saveTranslation(tx as unknown as Db, fresh, { language: t.language, kind: t.kind, refId, fields: t.fields })).saved) translationsAdded++;
        } catch (e) {
          if (!(e instanceof UserError || e instanceof NotFoundError)) throw e;
        }
      }
    }
    return {
      products: data.products.length,
      collections: data.collections.length,
      pages: data.pages.length,
      discountCodes: data.discount_codes.length,
      redirects: redirectsAdded,
      translations: translationsAdded,
      bundles: bundlesAdded,
      sales: salesAdded,
      checkoutAddons: addonsAdded,
      sizeCharts: chartsAdded,
      savedReplies: repliesAdded,
      tagRules: tagRulesAdded,
      theme: !!theme,
      currencyDiffers: typeof data.store.currency === "string" && data.store.currency !== shop.currency,
    };
  });
}

/** One row per variant, for spreadsheets and other platforms. Prices are in major units. */
export async function productsCsv(db: Db, shopId: string) {
  const products = await db.query.products.findMany({ where: eq(schema.products.shopId, shopId), orderBy: asc(schema.products.createdAt) });
  const variants = products.length
    ? groupBy(await db.query.variants.findMany({ where: inArray(schema.variants.productId, db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.shopId, shopId))), orderBy: asc(schema.variants.position) }), (v) => v.productId)
    : new Map<string, (typeof schema.variants.$inferSelect)[]>();
  const major = (m: number | null) => (m === null ? null : (m / 100).toFixed(2));
  const header = ["Handle", "Title", "Status", "Variant", "SKU", "Price", "Compare at price", "Cost", "Stock", "Image URL", "Supplier link"];
  const rows = products.flatMap((p) =>
    (variants.get(p.id) ?? [])
      .map((v) => [p.handle, p.title, p.status, v.title, v.sku, major(v.priceMinor), major(v.compareAtMinor), major(v.costMinor), v.stock, p.imageUrl, p.sourceUrl]),
  );
  return [header, ...rows].map((r) => r.map((c) => csvCell(c ?? null)).join(",")).join("\n") + "\n";
}

