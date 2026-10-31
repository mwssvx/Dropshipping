import "server-only";
// JSON API for the merchant app (apps/mobile), at /api/app/v1/*. It signs in with the same accounts
// and sessions as the web admin, but sends the session as "Authorization: Bearer <token>" and picks
// the store with "X-Shop-Id" (the person's first store if missing). Every handler calls the same
// core functions as the web admin, so rules and approvals are identical.
import {
  addManualTracking,
  aiBudget,
  askAssistant,
  assistantMessages,
  createSession,
  decideAction,
  deleteSession,
  fixProblemOrder,
  getOrder,
  orderDelivery,
  daysPastDelivery, orderParcels, ordersToSameAddress, addTrackingToSameBox,
  ordersPastDelivery,
  getPushSettings,
  getProduct,
  getSessionUser,
  importProduct,
  finishTwoStep,
  twoStepChallenge,
  APP_DEVICE,
  noteDevice,
  listOrders,
  orderPage,
  listPayouts,
  listProducts,
  listRefunds,
  listRequirements,
  listShopsForUser,
  moneySummary,
  addAdSpend,
  profitReport,
  NotFoundError,
  patchProduct,
  shipsInParcel,
  isOwnStock,
  missingDetails,
  setCustomsInfo,
  stockLevel,
  ordersToPost,
  reviewPage,
  reviewCounts,
  moderateReview,
  notifyReviewReply,
  unfilledFields,
  productPhotos,
  sendPriceDrops,
  sendStockAlerts,
  previewImport,
  refundOrder,
  registerDevice,
  requireMember,
  releaseHeldOrder,
  retryOrder,
  saveMedia,
  setProductImage,
  setPushSettings,
  signIn,
  submitRequirementDocument,
  todaySummary,
  unregisterDevice,
  UserError,
  writeListing,
  can,
  AREAS,
  type Area,
  type Role,
  type Shop,
  describePersonalization,
  getConversation,
  listInbox,
  listPendingActions,
  merchantReply,
  savedRepliesFor,
} from "@sf/core";
import type { Db } from "@sf/db";
import { BRAND } from "./brand";
import { agents, db, fulfillment, mailer, platformUrl, notifyLater, payments, refunds, stock, storeAddress, suppliers, testPayments } from "./server";

type User = { id: string; email: string };
type ShopLink = { id: string; name: string; handle: string; role: string };
type Ctx = { req: Request; url: URL; params: Record<string, string>; db: Db; user: User; shop: Shop; shops: ShopLink[]; role: Role };
type Handler = (c: Ctx) => Promise<unknown>;
type PublicHandler = (c: { req: Request; db: Db }) => Promise<unknown>;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const json = await req.json();
    if (json && typeof json === "object") return json as T;
  } catch {}
  throw new UserError("Send a JSON body.");
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/* What the app sees. Kept small: phones are on slow networks. */

type OrderRow = Awaited<ReturnType<typeof listOrders>>[number];
const orderSummary = (o: OrderRow) => ({
  id: o.id,
  number: o.number,
  email: o.email,
  name: o.shippingAddress.name,
  totalMinor: o.totalMinor,
  refundedMinor: o.refundedMinor,
  currency: o.currency,
  paymentStatus: o.paymentStatus,
  fulfillmentStatus: o.fulfillmentStatus,
  // Held back from the supplier by the risk check until someone sends or refunds it.
  held: isHeld(o),
  paidAt: o.paidAt,
  createdAt: o.createdAt,
});

type ProductRow = Awaited<ReturnType<typeof listProducts>>[number];
const productView = (p: ProductRow) => ({
  id: p.id,
  title: p.title,
  status: p.status,
  imageUrl: p.imageUrl,
  images: productPhotos(p),
  descriptionHtml: p.descriptionHtml,
  aiGenerated: p.aiGenerated,
  sourceUrl: p.sourceUrl,
  updatedAt: p.updatedAt,
  variants: p.variants.map((v) => ({ id: v.id, title: v.title, priceMinor: v.priceMinor, costMinor: v.costMinor, stock: v.stock, weightGrams: v.weightGrams, sku: v.sku })),
  /** Goes in a parcel, so it can have a weight. */
  ships: shipsInParcel(p),
  /** The store's own stock: the merchant sets what it costs. */
  ownStock: isOwnStock(p),
  /** What it still lacks, like a photo or a weight. */
  missing: missingDetails(p),
  hsCode: p.hsCode,
  originCountry: p.originCountry,
});

const isHeld = (o: OrderRow) => o.heldAt != null && ["paid", "partially_refunded"].includes(o.paymentStatus);

const ORDER_FILTERS: Record<string, (o: OrderRow) => boolean> = {
  all: () => true,
  problems: (o) => o.fulfillmentStatus === "problem" || isHeld(o),
  held: isHeld,
  to_send: (o) => ["paid", "partially_refunded"].includes(o.paymentStatus) && o.fulfillmentStatus === "unfulfilled" && !isHeld(o),
  open: (o) => ["paid", "partially_refunded"].includes(o.paymentStatus) && !["shipped", "delivered"].includes(o.fulfillmentStatus),
};

/* Routes */

async function appSession(db: Db, user: { id: string; email: string }) {
  await noteDevice({ db, mailer: mailer(), brand: BRAND, manageUrl: platformUrl("/admin/account") }, user.id, APP_DEVICE);
  const { token, expiresAt } = await createSession(db, user.id, APP_DEVICE);
  return { token, expiresAt, user, shops: await listShopsForUser(db, user.id) };
}

const publicRoutes: Record<string, PublicHandler> = {
  "POST auth/login": async ({ req, db }) => {
    const b = await body(req);
    const user = await signIn(db, { email: str(b.email), password: str(b.password) });
    // With two-step sign-in on, the app asks for the code and sends it to auth/two-step.
    const twoStep = await twoStepChallenge(db, user.id);
    if (twoStep) return { twoStep };
    return appSession(db, user);
  },
  "POST auth/two-step": async ({ req, db }) => {
    const b = await body(req);
    const done = await finishTwoStep({ db, mailer: mailer(), brand: BRAND }, str(b.twoStep), str(b.code));
    return appSession(db, { id: done.id, email: done.email });
  },
};

const shopView = (s: Shop) => ({ id: s.id, name: s.name, handle: s.handle, currency: s.currency, plan: s.plan, status: s.status });

const routes: Record<string, Handler> = {
  "POST auth/logout": async ({ req, db }) => {
    await deleteSession(db, bearer(req)!);
    return { ok: true };
  },

  "GET me": async ({ db, user, shop, shops, role }) => ({
    user,
    shop: { ...shopView(shop), address: await storeAddress(shop) },
    shops,
    role,
    // What this person's role can open, so the app hides the rest.
    can: AREAS.filter((a) => can(role, a)),
    push: await getPushSettings(db, user.id),
    testMode: testPayments(),
  }),
  "PUT me/push": async ({ req, db, user }) => {
    const b = await body<{ off?: unknown }>(req);
    if (!Array.isArray(b.off)) throw new UserError("Send the list of notifications to turn off.");
    return setPushSettings(db, user.id, { off: b.off.map(String) });
  },
  "POST devices": async ({ req, db, user }) => {
    const b = await body(req);
    await registerDevice(db, user.id, { token: str(b.token), platform: str(b.platform) });
    return { ok: true };
  },
  "DELETE devices": async ({ req, db, user }) => {
    await unregisterDevice(db, user.id, str((await body(req)).token));
    return { ok: true };
  },

  "GET today": async ({ db, shop, role }) => {
    notifyLater(shop.id);
    return todaySummary(db, shop, new Date(), role);
  },

  "GET orders": async ({ url, db, shop }) => {
    const show = url.searchParams.get("show") ?? "all";
    // Shipped parcels past their delivery date, the latest first, as on the web Orders page.
    if (show === "late") {
      const late = new Map((await ordersPastDelivery(db, shop)).map((l) => [l.id, l.daysLate]));
      const rows = (await listOrders(db, shop.id)).filter((o) => late.has(o.id)).sort((a, b) => late.get(b.id)! - late.get(a.id)! || a.number - b.number);
      return { orders: rows.slice(0, 200).map((o) => ({ ...orderSummary(o), daysLate: late.get(o.id)! })) };
    }
    // Orders with the store's own items to pack and post, oldest first, as on the packing slips.
    if (show === "to_post") return { orders: (await ordersToPost(db, shop.id)).slice(0, 200).map(orderSummary) };
    const keep = ORDER_FILTERS[show];
    if (!keep) throw new UserError("Unknown filter.");
    // The app shows the latest 200; for all orders that's one page, not the store's whole history.
    const orders = show === "all" ? (await orderPage(db, shop.id, {}, { size: 200 })).orders : (await listOrders(db, shop.id)).filter(keep).slice(0, 200);
    return { orders: orders.map(orderSummary) };
  },
  "GET orders/:id": async ({ params, db, shop }) => {
    const o = await getOrder(db, shop.id, params.id!);
    // When it should arrive, as on the web order page, and how late a shipped parcel is.
    const arrives = ["paid", "partially_refunded"].includes(o.paymentStatus) ? await orderDelivery(db, shop, o, { evenIfHidden: true }) : null;
    // An order from more than one supplier (or with the store's own stock), parcel by parcel.
    const parcels = o.pickup || o.localDelivery ? [] : await orderParcels(db, o);
    // The buyer's other orders to this door still to ship, as on the web order page.
    const sameDoor = o.paymentStatus === "paid" && o.fulfillmentStatus !== "shipped" && o.fulfillmentStatus !== "delivered" ? await ordersToSameAddress(db, shop.id, o) : null;
    // The store's own items still to post: its parcel in a mixed order, or the whole order when it's all its own.
    const ownParcel = parcels.find((p) => p.key === "own");
    const postYourself = o.paymentStatus === "paid" && !o.pickup && !o.localDelivery && (ownParcel ? !ownParcel.shipment?.trackingNumber : parcels.length === 0 && o.fulfillments.length === 0);
    return {
      postYourself: postYourself ? { own: !!ownParcel } : null,
      sameAddress: sameDoor?.orders.length
        ? { orders: sameDoor.orders.map((x) => ({ id: x.id, number: x.number, createdAt: x.createdAt, ownItems: x.ownItems })), oneBox: sameDoor.ownItems && sameDoor.orders.some((x) => x.ownItems) }
        : null,
      parcels: parcels.map((p) => ({
        own: p.key === "own",
        items: p.items,
        status: p.shipment?.status ?? null,
        carrier: p.shipment?.carrier ?? null,
        trackingNumber: p.shipment?.trackingNumber ?? null,
        trackingUrl: p.shipment?.trackingUrl ?? null,
      })),
      expectedDelivery: arrives ? { from: arrives.from, to: arrives.to } : null,
      daysLate: daysPastDelivery(arrives, o),
      ...orderSummary(o),
      shippingAddress: o.shippingAddress,
      subtotalMinor: o.subtotalMinor,
      shippingMinor: o.shippingMinor,
      discountMinor: o.discountMinor,
      discountCode: o.discountCode,
      bundleTitle: o.bundleTitle,
      taxMinor: o.taxMinor,
      taxExemptId: o.taxExemptId,
      protectionMinor: o.protectionMinor,
      giftWrapMinor: o.giftWrapMinor,
      tipMinor: o.tipMinor,
      buyerNote: o.buyerNote,
      staffNote: o.staffNote,
      tags: o.tags,
      lines: o.lines.map((l) => ({ title: l.title, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, personalization: describePersonalization(l.personalization) })),
      fulfillments: o.fulfillments.map((f) => ({
        status: f.status,
        problemMessage: f.problemMessage,
        backupNote: f.backupNote,
        carrier: f.carrier,
        trackingNumber: f.trackingNumber,
        trackingUrl: f.trackingUrl,
      })),
      refunds: (await listRefunds(db, o.id)).map((r) => ({ amountMinor: r.amountMinor, reason: r.reason, createdAt: r.createdAt })),
      refundableMinor: ["paid", "partially_refunded"].includes(o.paymentStatus) ? o.totalMinor - o.refundedMinor : 0,
      risk: o.risk ? { level: o.risk.level, reasons: o.risk.reasons } : null,
    };
  },
  "POST orders/:id/release": async ({ params, shop }) => {
    await releaseHeldOrder(await fulfillment(), shop.id, params.id!);
    notifyLater(shop.id);
    return { ok: true, message: "Sent to the supplier." };
  },
  "POST orders/:id/retry": async ({ params, shop }) => {
    await retryOrder(await fulfillment(), shop.id, params.id!);
    return { ok: true, message: "Sent to the supplier again." };
  },
  "POST orders/:id/refund": async ({ req, params, shop }) => {
    const b = await body(req);
    const amountMinor = b.amountMinor === undefined || b.amountMinor === null ? undefined : Number(b.amountMinor);
    await refundOrder(await refunds(), shop.id, params.id!, { amountMinor, reason: str(b.reason) || null });
    return { ok: true, message: "Refunded. The buyer gets an email." };
  },
  "POST orders/:id/tracking": async ({ req, params, shop }) => {
    const b = await body(req);
    const ctx = await fulfillment();
    const input = { carrier: str(b.carrier), trackingNumber: str(b.trackingNumber), url: str(b.url) };
    // own: the store's own parcel in an order a supplier sends part of. also: orders packed in the same box.
    await addManualTracking(ctx, shop.id, params.id!, { ...input, own: b.own === true });
    const also = Array.isArray(b.also) ? b.also.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
    const shared = await addTrackingToSameBox(ctx, shop.id, params.id!, also, input);
    return { ok: true, message: shared.length ? `Tracking added here and to ${shared.map((n) => `order #${n}`).join(", ")}. The buyers get an email.` : "Tracking added. The buyer gets an email." };
  },
  "POST orders/:id/fix": async ({ params, shop }) => {
    const run = await fixProblemOrder(await agents(), shop, params.id!);
    notifyLater(shop.id);
    return { ok: true, message: run.text };
  },

  "GET products": async ({ db, shop }) => ({
    products: (await listProducts(db, shop.id)).map((p) => ({ ...productView(p), stockLevel: stockLevel(p, shop.restockAlertAt) })),
  }),
  "GET products/:id": async ({ params, db, shop }) => productView(await getProduct(db, shop.id, params.id!)),
  "PATCH products/:id": async ({ req, params, db, shop }) => {
    const product = await patchProduct(db, shop.id, params.id!, await body(req));
    const ctx = await stock();
    await sendStockAlerts(ctx, { shopId: shop.id });
    await sendPriceDrops(ctx, { shopId: shop.id });
    return productView(product);
  },
  "PUT products/:id/customs": async ({ req, params, db, shop }) => {
    const b = await body<{ hsCode?: unknown; originCountry?: unknown }>(req);
    // Where it ships from stays as it is: that's set on the website.
    await setCustomsInfo(db, shop.id, params.id!, { hsCode: str(b.hsCode), originCountry: str(b.originCountry) });
    return productView(await getProduct(db, shop.id, params.id!));
  },
  "POST products/:id/listing": async ({ params, shop }) => {
    const run = await writeListing(await agents(), shop, params.id!);
    return { ok: true, message: run.text };
  },
  "POST products/:id/photo": async ({ req, url, params, db, shop }) => {
    await getProduct(db, shop.id, params.id!);
    const data = Buffer.from(await req.arrayBuffer());
    const { id } = await saveMedia(db, shop.id, data);
    const product = await setProductImage(db, shop.id, params.id!, `${url.origin}/api/media/${id}`);
    return { ok: true, imageUrl: product.imageUrl };
  },

  "POST imports/preview": async ({ req, db, shop }) => {
    const b = await body<{ url?: unknown; warehouse?: unknown }>(req);
    const p = await previewImport(db, suppliers(), shop.id, str(b.url), typeof b.warehouse === "string" ? b.warehouse : null);
    return {
      supplier: p.supplier,
      alreadyImported: p.alreadyImported,
      // Listings sold from several warehouses: the one these options come from, and the others.
      warehouse: p.warehouse,
      warehouses: p.warehouses.map((w) => w.name),
      product: {
        title: p.product.title,
        imageUrl: p.product.images[0] ?? null,
        variants: p.product.variants.map((v) => ({ ref: v.ref, title: v.title, costMinor: v.costMinor, stock: v.stock, suggestedPriceMinor: p.suggestedPrices[v.ref] })),
      },
    };
  },
  "POST imports": async ({ req, db, shop }) => {
    const b = await body<{ url?: unknown; title?: unknown; prices?: Record<string, number>; publish?: unknown; warehouse?: unknown }>(req);
    const product = await importProduct(db, suppliers(), shop.id, { url: str(b.url), title: str(b.title), prices: b.prices ?? {}, publish: b.publish === true, warehouse: typeof b.warehouse === "string" ? b.warehouse : null });
    return { ok: true, id: product.id };
  },

  "GET money": async ({ db, shop }) => {
    const [summary, payouts, requirements, profit] = await Promise.all([moneySummary(db, shop), listPayouts(db, shop.id, 10), listRequirements(db, shop.id), profitReport(db, shop, 30)]);
    return {
      ...summary,
      // The products earning (or losing) the most in the last 30 days, after ads.
      topProducts: profit.products.slice(0, 5).map((p) => ({ title: p.title, units: p.units, profitMinor: p.profitMinor, adsMinor: p.adsMinor, roas: p.roas })),
      payoutsEnabled: shop.payoutsEnabled,
      payouts: payouts.map((p) => ({ id: p.id, amountMinor: p.amountMinor, status: p.status, arrivalDate: p.arrivalDate })),
      holds: requirements.map((r) => ({
        id: r.id,
        title: r.title,
        explanation: r.explanation,
        holdsPayouts: r.holdsPayouts,
        dueBy: r.dueBy,
        submittedAt: r.submittedAt,
        upload: r.upload,
      })),
    };
  },
  "POST money/ad-spend": async ({ req, db, shop, user }) => {
    const b = await body<{ day?: unknown; channel?: unknown; amountMinor?: unknown }>(req);
    await addAdSpend(db, shop.id, { day: str(b.day) || new Date().toISOString().slice(0, 10), channel: str(b.channel) as never, amountMinor: typeof b.amountMinor === "number" ? b.amountMinor : 0 }, { userId: user.id });
    return { ok: true, message: "Ad spend added." };
  },
  "POST money/holds/:id/document": async ({ req, params, db, shop }) => {
    const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim();
    const data = Buffer.from(await req.arrayBuffer());
    await submitRequirementDocument(db, payments(), shop, params.id!, { name: `document.${type.split("/")[1] ?? "bin"}`, type, data });
    return { ok: true, message: "Sent. We'll tell you when it's checked." };
  },

  "GET reviews": async ({ url, db, shop }) => {
    const show = url.searchParams.get("show");
    // Waiting for your OK, published with no reply yet, or the latest of all.
    const filter = show === "no_reply" ? { status: "published" as const, noReply: true } : show === "all" ? {} : { status: "pending" as const };
    const [{ reviews }, counts, noReply] = await Promise.all([
      reviewPage(db, shop.id, { ...filter, size: 100 }),
      reviewCounts(db, shop.id),
      reviewPage(db, shop.id, { status: "published", noReply: true, size: 1 }),
    ]);
    return {
      counts: { pending: counts.pending, noReply: noReply.total },
      reviews: reviews.map(({ review: r, productTitle }) => ({
        id: r.id,
        name: r.name,
        rating: r.rating,
        body: r.body,
        status: r.status,
        reply: r.reply,
        photos: r.photoIds.length,
        productTitle,
        createdAt: r.createdAt,
      })),
    };
  },
  "POST reviews/:id": async ({ req, params, db, shop }) => {
    const b = await body<{ status?: unknown; reply?: unknown }>(req);
    const status = b.status === "published" || b.status === "hidden" ? b.status : undefined;
    const reply = typeof b.reply === "string" ? b.reply : undefined;
    if (reply !== undefined) {
      const missing = unfilledFields(reply);
      if (missing.length) throw new UserError(`Replace ${missing.join(" and ")} first: this review has nothing to fill it with.`);
    }
    const r = (await moderateReview(db, shop.id, params.id!, { status, reply }))!;
    // The buyer hears about the first reply once the review is live, as from the website.
    if (r.status === "published" && r.reply) await notifyReviewReply(db, mailer(), shop, r.id, await storeAddress(shop)).catch((e) => console.error("review reply email failed", e));
    const message = status === "hidden" ? "Hidden from your store." : reply !== undefined ? (r.status === "published" ? "Reply posted." : "Reply saved. It shows once you publish the review.") : "Published on your store.";
    return { ok: true, message };
  },
  "GET inbox": async ({ url, db, shop }) => {
    const show = url.searchParams.get("show") === "all" ? "all" : "needs_you";
    const rows = await listInbox(db, shop.id, show);
    return {
      conversations: rows.map((c) => ({
        id: c.id,
        subject: c.subject,
        status: c.status,
        drafts: c.drafts,
        last: c.last ? { author: c.last.author, body: c.last.body.slice(0, 200) } : null,
        updatedAt: c.updatedAt,
      })),
    };
  },
  "GET inbox/:id": async ({ params, db, shop }) => {
    const { conversation: c, messages, order } = await getConversation(db, shop.id, params.id!);
    const ids = new Set(messages.map((m) => m.id));
    const [pending, saved] = await Promise.all([
      listPendingActions(db, shop.id).then((r) => r.filter((a) => ids.has(String(a.input.message_id)))),
      c.email ? savedRepliesFor(db, shop.id, c.id) : [],
    ]);
    return {
      id: c.id,
      subject: c.subject,
      status: c.status,
      statusReason: c.statusReason,
      email: c.email,
      order: order ? { id: order.id, number: order.number, name: order.shippingAddress.name } : null,
      messages: messages.filter((m) => m.status === "sent").map((m) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt })),
      // A reply the assistant drafted, waiting for the merchant's OK.
      pending,
      saved,
    };
  },
  "POST inbox/:id/reply": async ({ req, params, shop }) => {
    const r = await merchantReply(await fulfillment(), shop.id, params.id!, str((await body(req)).message));
    notifyLater(shop.id);
    return { ok: true, status: r.status, message: r.status === "failed" ? "Saved, but the email didn't go out. Try again in a minute." : "Sent by email." };
  },

  "GET assistant": async ({ db, shop }) => {
    const [messages, budget] = await Promise.all([assistantMessages(db, shop.id, 40), aiBudget(db, shop)]);
    return {
      messages: messages.map((m) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt })),
      budget: { limitMinor: budget.limitMinor, spentMinor: budget.spentMinor, left: budget.left, resetsOn: budget.resetsOn },
      demo: !(await agents()).model.live,
    };
  },
  "POST assistant": async ({ req, shop }) => {
    const run = await askAssistant(await agents(), shop, str((await body(req)).message));
    notifyLater(shop.id);
    return { ok: true, reply: run.text };
  },
  "POST actions/:id": async ({ req, params, user, shop }) => {
    const b = await body(req);
    if (typeof b.approve !== "boolean") throw new UserError("Say whether to approve.");
    const action = await decideAction(await agents(), shop.id, params.id!, {
      approve: b.approve,
      by: user.email,
      message: typeof b.message === "string" ? b.message : undefined,
    });
    return { ok: true, status: action.status, message: b.approve ? "Done." : "Turned down. Nothing was changed." };
  },
};

/** The part of the store each route belongs to; routes not listed are open to every member. */
function routeArea(key: string): Area | null {
  if (key === "POST orders/:id/refund") return "refunds";
  const path = key.split(" ")[1]!;
  if (path.startsWith("orders")) return "orders";
  if (path.startsWith("products") || path.startsWith("imports")) return "products";
  if (path.startsWith("money")) return "money";
  if (path.startsWith("assistant") || path.startsWith("actions")) return "assistant";
  if (path.startsWith("inbox")) return "inbox";
  if (path.startsWith("reviews")) return "reviews";
  if (path === "today") return "home";
  return null;
}

function bearer(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

function match(method: string, path: string, table: Record<string, unknown>) {
  const parts = path.split("/").filter(Boolean);
  for (const key of Object.keys(table)) {
    const [m, pattern] = key.split(" ") as [string, string];
    if (m !== method) continue;
    const pp = pattern.split("/");
    if (pp.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (pp.every((p, i) => (p.startsWith(":") ? ((params[p.slice(1)] = decodeURIComponent(parts[i]!)), true) : p === parts[i]))) return { key, params };
  }
  return null;
}

/** Browsers only: the app itself has no origin. APP_WEB_ORIGINS lists the web builds allowed in. */
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowed = (process.env.APP_WEB_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type, x-shop-id",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

export async function handleAppRequest(req: Request, path: string[]): Promise<Response> {
  const headers = { ...cors(req), "cache-control": "no-store" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const route = path.join("/");
  try {
    const database = await db();
    const pub = match(req.method, route, publicRoutes);
    if (pub) return Response.json(await publicRoutes[pub.key]!({ req, db: database }), { headers });
    const found = match(req.method, route, routes);
    if (!found) throw new HttpError(404, "Not found.");

    const user = await getSessionUser(database, bearer(req) ?? undefined);
    if (!user) throw new HttpError(401, "Please sign in again.");
    const shops = await listShopsForUser(database, user.id);
    if (!shops.length) throw new HttpError(409, "Create your store on the web first.");
    const wanted = req.headers.get("x-shop-id");
    const pick = (wanted && shops.find((s) => s.id === wanted)) || shops[0]!;
    const { shop, role } = await requireMember(database, user.id, pick.id);
    const area = routeArea(found.key);
    if (area && !can(role, area)) throw new HttpError(403, "Your role on this store doesn't include this. The owner can change it.");
    const result = await routes[found.key]!({ req, url: new URL(req.url), params: found.params, db: database, user, shop, shops, role });
    return Response.json(result, { headers });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status, headers });
    if (e instanceof NotFoundError) return Response.json({ error: e.message }, { status: 404, headers });
    if (e instanceof UserError) return Response.json({ error: e.message, code: e.code }, { status: 400, headers });
    console.error(`App API ${req.method} /${route} failed`, e);
    return Response.json({ error: "Something went wrong on our side. Please try again." }, { status: 500, headers });
  }
}
