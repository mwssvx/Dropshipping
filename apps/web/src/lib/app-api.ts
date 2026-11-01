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
  listCustomers,
  getCustomerProfile,
  updateCustomerNotes,
  customerOfOrder,
  countReturns,
  listReturns,
  decideReturn,
  RETURN_REASON_LABELS,
  type ReturnDecision,
  repeatBuyers,
  COME_BACK_DAYS,
  createPage,
  updatePage,
  deletePage,
  listPages,
  getPage,
  draftPolicies,
  addPolicyPages,
  listNotices,
  markNoticesRead,
  verifiedChecklist,
  submitAppeal,
  refreshVerified,
  createPost,
  updatePost,
  setPostPublished,
  deletePost,
  listPosts,
  getPost,
  isScheduled,
  POST_TAGS_MAX,
  searchReport,
  setSearchFix,
  removeSearchFix,
  SEARCH_TERM_MAX,
  MAX_SEARCH_FIXES,
  keepScheduledTheme,
  cancelThemeSchedule,
  scheduleTheme,
  publishTheme,
  getTheme,
  syncProductStock,
  removeBackupSupplier,
  setBackupSupplier,
  setDeliveryEstimates,
  createGiftCardProduct,
  giftCardProduct,
  setHolidayReturns,
  setWelcomeOffer,
  describeWelcomeOffer,
  setSignupPopup,
  SIGNUP_POPUP_SECONDS,
  SIGNUP_POPUP_ON_LEAVE,
  setGrowthSettings,
  setAbandonedCartOffer,
  setGiftWrap,
  MAX_GIFT_WRAP_NOTE,
  createGiftGuides,
  giftGuideTitles,
  holidayChecklist,
  holidaySeason,
  createCollection,
  getCollection,
  deleteCollection,
  listCollections,
  collectionsOfProduct,
  setProductInCollection,
  MAX_PRODUCT_TAGS,
  productTags,
  HOLIDAY_NAME_MAX,
  setHolidayDeadline,
  LATE_ORDER_DAYS,
  LATE_ORDER_MESSAGE_MAX,
  setLateOrderNotice,
  activeShipPause,
  setShipPause,
  SHIP_PAUSE_MAX_DAYS,
  SHIP_PAUSE_MESSAGE_MAX,
  codeBatchCsv,
  createCodeBatch,
  listCodeBatches,
  MAX_BATCH,
  setCodeBatchActive,
  createTagRule,
  deleteTagRule,
  describeTagRule,
  listTagRules,
  MAX_TAG_RULES,
  type TagRuleInput,
  bundleProductChoices,
  createBundle,
  deleteBundle,
  listBundles,
  MAX_BUNDLE_PERCENT,
  MAX_BUNDLES,
  setBundleActive,
  addStarterReplies,
  deleteSavedReply,
  listSavedReplies,
  MAX_SAVED_REPLIES,
  REPLY_FIELDS,
  saveSavedReply,
  STARTER_REPLIES,
  preordersSold,
  setPreorder,
  setPurchaseLimit,
  BANK_DETAILS_MAX,
  markTransferPaid,
  setBankTransfer,
  TRANSFER_DAYS,
  transferDueBy,
  adjustPoints,
  customerPoints,
  describeRewards,
  rewardsSummary,
  setRewardsSettings,
  setSurvey,
  surveyReport,
  audienceSizes,
  AUDIENCE_LABELS,
  campaignAllowance,
  createCampaign,
  deleteCampaign,
  listCampaigns,
  sendCampaignBatches,
  sendTestCampaign,
  setMailingAddress,
  startCampaign,
  createPartner,
  formatRate,
  listPartners,
  PARTNER_HOLD_DAYS,
  recordPartnerPayout,
  resetPartnerLink,
  setPartnerActive,
  addWholesaleBuyer,
  parseMoney,
  decideWholesale,
  listWholesaleBuyers,
  setWholesaleSettings,
  CART_LINK_MAX_LINES,
  cartLinkChoices,
  createCartLink,
  deleteCartLink,
  listCartLinks,
  addOwnSupplier,
  listOwnSuppliers,
  removeOwnSupplier,
  resetSupplierLink,
  SCORE_MIN_ORDERS,
  supplierLabel,
  supplierScorecard,
  updateOwnSupplier,
  applySupplierCost,
  listCostChanges,
  resolveCostChange,
  setPriceWatch,
  recordStockCount,
  cancelRestockOrder,
  createRestockOrder,
  getRestockOrder,
  listRestockOrders,
  receiveRestock,
  restockChoices,
  cancelInvite,
  changeRole,
  inviteMember,
  PLANS,
  removeMember,
  ROLES,
  teamSeats,
  cancelSubscriptionForBuyer,
  intervalLabel,
  listSubscriptions,
  renewSubscription,
  subscriptionStats,
  listActivity,
  listTeam,
  analyticsReport,
  comparisonRange,
  CUTOFF_TIME_ZONES,
  defaultCutoffZone,
  periodTotals,
  whenBuyersBuy,
  countryName,
  createPaymentLink,
  listActiveProducts,
  listShippingZones,
  resendPaymentLink,
  shipsTo,
  answerQuestion,
  listQuestions,
  setQuestionPublished,
  waitingQuestions,
  acceptDispute,
  countOpenDisputes,
  disputeEvidence,
  disputeReason,
  disputesForOrder,
  disputeStats,
  listDisputes,
  submitDispute,
  abandonedCheckouts,
  ABANDONED_DAYS,
  isOrderBuyerBlocked,
  blockOrderBuyer,
  blockBuyer,
  listBlockedBuyers,
  unblockBuyer,
  activeClosure,
  setStoreClosure,
  listGiftCards,
  resendGiftCard,
  setGiftCardDisabled,
  markReadyForPickup,
  markPickedUp,
  markDeliveredByStore,
  listSales,
  createSale,
  endSale,
  extendSale,
  SALE_EXTEND_DAYS,
  issueGiftCard,
  formatMoney,
  listDiscounts,
  describeDiscount,
  createDiscount,
  setDiscountActive,
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
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { BRAND } from "./brand";
import { afterOrderPaid } from "./webhooks";
import { agents, campaigns, db, fulfillment, logged, mailer, platformUrl, notifyLater, payments, refunds, stock, storeAddress, partnerPortalUrl, subscriptions, supplierPortalUrl, suppliers, tax, testPayments } from "./server";

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

/** A blog post as the app lists it: a draft, waiting for its time, or live, with its store link. */
function blogPostView(p: { id: string; title: string; handle: string; status: "draft" | "published"; publishedAt: Date | null; updatedAt: Date; tags: string[] }, store: string) {
  const state = p.status !== "published" ? "draft" : isScheduled(p) ? "scheduled" : "live";
  return { id: p.id, title: p.title, state, publishedAt: p.publishedAt, updatedAt: p.updatedAt, tags: p.tags, url: `${store.replace(/\/$/, "")}/blog/${p.handle}` };
}

/** Stock on the store is the main supplier's plus the backup's, so it's re-read after a change. */
async function resyncStock(shopId: string, productId: string) {
  try {
    await syncProductStock(await stock(), shopId, productId);
  } catch (e) {
    if (!(e instanceof UserError)) throw e; // a supplier that's down is read again at the daily check
  }
}

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
  variants: p.variants.map((v) => ({ id: v.id, title: v.title, priceMinor: v.priceMinor, compareAtMinor: v.compareAtMinor, costMinor: v.costMinor, stock: v.stock, weightGrams: v.weightGrams, sku: v.sku })),
  /** Goes in a parcel, so it can have a weight. */
  ships: shipsInParcel(p),
  /** The store's own stock: the merchant sets what it costs. */
  ownStock: isOwnStock(p),
  /** What it still lacks, like a photo or a weight. */
  missing: missingDetails(p),
  hsCode: p.hsCode,
  originCountry: p.originCountry,
  /** Sold-out options can still be ordered, promised to ship by a date. */
  preorder: p.preorder,
  /** The least and most a buyer can order. */
  purchaseLimit: p.purchaseLimit,
  tags: p.tags,
});

const customerView = (p: Awaited<ReturnType<typeof getCustomerProfile>>) => ({
  id: p.customer.id,
  name: p.customer.name,
  email: p.customer.email,
  note: p.customer.note,
  tags: p.customer.tags,
  stats: p.stats,
  storeCreditMinor: p.storeCreditMinor,
  // The latest 20 is plenty on a phone; the website has the rest.
  orders: p.orders.slice(0, 20),
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

/** An order's disputes for the app; while one waits for an answer, what the evidence has and lacks. */
async function orderDisputes(db: Db, shop: Shop, orderId: string) {
  const rows = await disputesForOrder(db, orderId);
  return Promise.all(
    rows.map(async (d) => ({
      id: d.id,
      status: d.status,
      inquiry: d.inquiry,
      reason: disputeReason(d.reason).label,
      tip: disputeReason(d.reason).tip,
      amountMinor: d.amountMinor,
      currency: d.currency,
      evidenceDueBy: d.evidenceDueBy,
      note: d.note,
      submittedAt: d.submittedAt,
      checks: d.status === "needs_response" ? (await disputeEvidence(db, shop, d.id)).checks : [],
    })),
  );
}

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

  "GET store-status": async ({ shop }) => {
    const c = activeClosure(shop);
    return { mode: c?.mode ?? "open", message: c?.message ?? null, until: c?.until ?? null };
  },
  "PUT store-status": async ({ req, db, shop, user }) => {
    const b = await body<{ mode?: unknown; message?: unknown; until?: unknown }>(req);
    // A break or open from the phone; a password page (with its password) is set on the website.
    const mode = b.mode === "holiday" ? "holiday" : b.mode === "open" ? "open" : null;
    if (!mode) throw new HttpError(400, "Pick open or a break.");
    const c = await setStoreClosure(db, shop, { mode, message: str(b.message), until: str(b.until) });
    await logged({ shop, user, db }, mode === "open" ? "Opened the store to everyone in the app" : "Put the store on a break in the app", { href: "/admin/store-status" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return {
      mode,
      message: c?.message ?? null,
      until: c?.until ?? null,
      said: mode === "open" ? "Your store is open. Buyers can order again." : `Your store is on a break${c?.until ? ` until ${c.until}` : ""}. Buyers can look around but can't order.`,
    };
  },
  "GET today": async ({ db, shop, role }) => {
    notifyLater(shop.id);
    const [today, returns, reviews, questions] = await Promise.all([
      todaySummary(db, shop, new Date(), role),
      can(role, "returns") ? countReturns(db, shop.id, "open") : null,
      can(role, "reviews") ? reviewCounts(db, shop.id).then((c) => c.pending) : null,
      can(role, "reviews") ? waitingQuestions(db, shop.id) : null,
    ]);
    // What waits behind the Returns, Reviews and Questions buttons, so Today says it without opening them.
    return { ...today, waiting: { returns, reviews, questions } };
  },

  "GET orders": async ({ url, db, shop }) => {
    // A search looks through every order, by number, name or email, as on the web Orders page.
    const q = url.searchParams.get("q")?.trim().slice(0, 100);
    if (q) return { orders: (await orderPage(db, shop.id, { query: q }, { size: 50 })).orders.map(orderSummary) };
    const show = url.searchParams.get("show") ?? "all";
    // Shipped parcels past their delivery date, the latest first, as on the web Orders page.
    if (show === "late") {
      const late = new Map((await ordersPastDelivery(db, shop)).map((l) => [l.id, l.daysLate]));
      const rows = (await listOrders(db, shop.id)).filter((o) => late.has(o.id)).sort((a, b) => late.get(b.id)! - late.get(a.id)! || a.number - b.number);
      return { orders: rows.slice(0, 200).map((o) => ({ ...orderSummary(o), daysLate: late.get(o.id)! })) };
    }
    // Orders with the store's own items to pack and post, oldest first, as on the packing slips.
    if (show === "to_post") return { orders: (await ordersToPost(db, shop.id)).slice(0, 200).map(orderSummary) };
    // Paid pickups and local deliveries not handed over yet, the soonest day first (no day picked: last).
    if (show === "handover") {
      const rows = (await listOrders(db, shop.id))
        .filter((o) => (o.pickup || o.localDelivery) && ["paid", "partially_refunded"].includes(o.paymentStatus) && o.fulfillmentStatus !== "delivered")
        .sort((a, b) => (a.handoverOn ?? "9999").localeCompare(b.handoverOn ?? "9999") || a.number - b.number);
      return { orders: rows.slice(0, 200).map((o) => ({ ...orderSummary(o), handover: { kind: o.pickup ? "pickup" : "delivery", day: o.handoverOn, ready: !!o.pickupReadyAt } })) };
    }
    const keep = ORDER_FILTERS[show];
    if (!keep) throw new UserError("Unknown filter.");
    // The app shows the latest 200; for all orders that's one page, not the store's whole history.
    const orders = show === "all" ? (await orderPage(db, shop.id, {}, { size: 200 })).orders : (await listOrders(db, shop.id)).filter(keep).slice(0, 200);
    return { orders: orders.map(orderSummary) };
  },
  "GET orders/:id": async ({ params, db, shop, role }) => {
    const o = await getOrder(db, shop.id, params.id!);
    // When it should arrive, as on the web order page, and how late a shipped parcel is.
    const arrives = ["paid", "partially_refunded"].includes(o.paymentStatus) ? await orderDelivery(db, shop, o, { evenIfHidden: true }) : null;
    // An order from more than one supplier (or with the store's own stock), parcel by parcel.
    const parcels = o.pickup || o.localDelivery ? [] : await orderParcels(db, o);
    // The buyer's other orders to this door still to ship, as on the web order page.
    const sameDoor = o.paymentStatus === "paid" && o.fulfillmentStatus !== "shipped" && o.fulfillmentStatus !== "delivered" ? await ordersToSameAddress(db, shop.id, o) : null;
    // The store's own items still to post: its parcel in a mixed order, or the whole order when it's all its own.
    const ownParcel = parcels.find((p) => p.key === "own");
    // Who bought it, for a link to their customer screen (only for roles that can open customers).
    const buyer = can(role, "customers") ? await customerOfOrder(db, shop.id, o.email) : null;
    const postYourself = o.paymentStatus === "paid" && !o.pickup && !o.localDelivery && (ownParcel ? !ownParcel.shipment?.trackingNumber : parcels.length === 0 && o.fulfillments.length === 0);
    return {
      customer: buyer,
      // A payment link still waiting: the link to share again, and the note that went with it.
      payLink: o.source === "payment_link" && (o.paymentStatus === "pending" || o.paymentStatus === "failed") ? { url: `${await storeAddress(shop)}/pay/${o.id}`, note: o.note } : null,
      // The buyer chose to pay by bank transfer: when it should arrive, and whether this person can mark it paid.
      transfer: o.manualPayment === "bank_transfer" && o.paymentStatus === "pending" ? { dueBy: transferDueBy(shop, o), canMark: can(role, "money") } : null,
      // A buyer's bank pulling the money back, with what the evidence has and lacks while it waits for an answer.
      disputes: can(role, "money") ? await orderDisputes(db, shop, o.id) : [],
      // On the store's blocked list (by email or address), so checkout turns them away.
      blocked: await isOrderBuyerBlocked(db, shop.id, o),
      // Collected by the buyer or dropped off by the store: no tracking, the merchant says when it's done.
      handover:
        o.pickup || o.localDelivery
          ? { kind: o.pickup ? "pickup" : "delivery", day: o.handoverOn, readyAt: o.pickupReadyAt, done: o.fulfillmentStatus === "delivered" }
          : null,
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
  // Payment links: an order built for a buyer who asked by message, emailed to them to pay by card.
  "GET payment-links/new": async ({ db, shop }) => {
    const [products, { zones }] = await Promise.all([listActiveProducts(db, shop.id), listShippingZones(db, shop.id)]);
    const countries = shipsTo(zones)
      .map((c) => [c, countryName(c)] as [string, string])
      .sort((a, b) => a[1].localeCompare(b[1]));
    return {
      variants: products
        .filter((p) => !p.giftCard)
        .flatMap((p) => p.variants.map((v) => ({ id: v.id, title: v.title === "Default" ? p.title : `${p.title} – ${v.title}`, priceMinor: v.priceMinor, stock: v.stock }))),
      countries,
      defaultCountry: countries.some(([c]) => c === shop.country) ? shop.country : (countries[0]?.[0] ?? "US"),
    };
  },
  "POST payment-links": async ({ req, db, shop, user }) => {
    const b = await body<Record<string, unknown>>(req);
    const lines = (Array.isArray(b.lines) ? b.lines : [])
      .slice(0, 20)
      .map((l: { variantId?: unknown; quantity?: unknown }) => ({ variantId: str(l?.variantId), quantity: Math.min(99, Math.max(0, Math.floor(Number(l?.quantity) || 0))) }))
      .filter((l) => l.variantId);
    const opt = (k: string) => str(b[k]).trim() || undefined;
    const { order, sent } = await createPaymentLink(
      await refunds(),
      shop,
      {
        email: str(b.email).trim(),
        address: { name: str(b.name).trim(), line1: str(b.line1).trim(), line2: opt("line2"), city: str(b.city).trim(), region: opt("region"), postalCode: str(b.postalCode).trim(), country: str(b.country).trim(), phone: opt("phone") },
        lines,
        discountCode: opt("discountCode") ?? null,
        note: str(b.note),
      },
      tax(),
    );
    await logged({ shop, user, db }, `Made a payment link for order {order} in the app`, { orderId: order.id });
    return {
      ok: true,
      orderId: order.id,
      url: `${await storeAddress(shop)}/pay/${order.id}`,
      sent,
      message: sent ? `Payment link emailed to ${order.email}.` : "The order is ready, but the email didn't go out. Share the link instead.",
    };
  },
  "POST orders/:id/payment-link": async ({ params, db, shop }) => {
    await resendPaymentLink(await refunds(), shop.id, params.id!);
    const o = await getOrder(db, shop.id, params.id!);
    return { ok: true, message: `Emailed to ${o.email} again.` };
  },
  // How the store is doing over 7, 30 or 90 days, against the days before or the same days last year, as on the web.
  "GET analytics": async ({ url, db, shop }) => {
    const days = [7, 30, 90].find((d) => String(d) === url.searchParams.get("days")) ?? 7;
    const compare = url.searchParams.get("compare") === "year" ? "year" : "previous";
    const now = new Date();
    const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 86_400_000;
    const range = { from: new Date(to - days * 86_400_000), to: new Date(to) };
    const zone = shop.shipCutoff?.timeZone ?? defaultCutoffZone(shop.country);
    const [r, before, when, searches, repeat] = await Promise.all([
      analyticsReport(db, shop.id, range),
      periodTotals(db, shop.id, comparisonRange(range, compare), now),
      whenBuyersBuy(db, shop.id, range, CUTOFF_TIME_ZONES.some(([z]) => z === zone) ? zone : "UTC"),
      searchReport(db, shop.id, range, 5),
      repeatBuyers(db, shop.id, { now }),
    ]);
    return {
      days,
      compare,
      now: { salesMinor: r.salesMinor, orders: r.orders, averageOrderMinor: r.averageOrderMinor, visitors: r.visitors, conversion: r.conversion },
      before,
      byDay: r.days.map((d) => ({ date: d.date, salesMinor: d.salesMinor, orders: d.orders })),
      funnel: r.funnel,
      topProducts: r.topProducts.slice(0, 5),
      salesBySource: r.salesBySource.slice(0, 5),
      sources: r.sources.slice(0, 5),
      busiest: when.busiest,
      // What shoppers typed into the store's search box; only the words are kept, never who searched.
      // First-time buyers each month and how many ordered again within 90 days.
      repeat: { months: repeat.months, share: repeat.share, averageDays: repeat.averageDays, days: COME_BACK_DAYS },
      searches: { total: searches.searches, nothingShare: searches.nothingShare, top: searches.top, nothing: searches.nothing.map((t) => ({ term: t.term, searches: t.searches })) },
    };
  },
  // Who on the team did what, newest first, as on the web's Activity page. Order entries open the order in the app.
  "GET activity": async ({ url, db, shop }) => {
    const person = url.searchParams.get("person") || undefined;
    const beforeParam = url.searchParams.get("before");
    const before = beforeParam && !Number.isNaN(Date.parse(beforeParam)) ? new Date(beforeParam) : undefined;
    const [{ entries, next }, { members }] = await Promise.all([listActivity(db, shop.id, { userId: person, before }), listTeam(db, shop.id)]);
    return {
      members: members.map((m) => ({ userId: m.userId, email: m.email, name: m.name, role: m.role })),
      entries: entries.map((e) => ({ id: e.id, email: e.email, summary: e.summary, createdAt: e.createdAt, orderId: e.href?.match(/^\/admin\/orders\/([0-9a-f-]{36})$/)?.[1] ?? null })),
      next,
    };
  },
  // Subscribe and save: buyers who get their order again every few weeks.
  "GET subscriptions": async ({ url, db, shop }) => {
    const show = url.searchParams.get("show");
    const status = show === "failing" || show === "paused" || show === "cancelled" ? show : show === "all" ? undefined : "active";
    const q = url.searchParams.get("q")?.trim().slice(0, 100) || undefined;
    const [stats, subs] = await Promise.all([subscriptionStats(db, shop.id), listSubscriptions(db, shop.id, { status, query: q, size: 30 })]);
    const ids = [...new Set(subs.flatMap((x) => x.lines.map((l) => l.variantId)))];
    const variants = ids.length ? await db.query.variants.findMany({ where: (v, { inArray }) => inArray(v.id, ids), columns: { id: true, title: true, productId: true } }) : [];
    const productIds = [...new Set(variants.map((v) => v.productId))];
    const products = new Map(
      productIds.length ? (await db.query.products.findMany({ where: (p, { inArray }) => inArray(p.id, productIds), columns: { id: true, title: true } })).map((p) => [p.id, p.title]) : [],
    );
    const titles = new Map(variants.map((v) => [v.id, v.title === "Default" ? (products.get(v.productId) ?? "") : `${products.get(v.productId) ?? ""} – ${v.title}`]));
    return {
      stats,
      testMode: testPayments(),
      subscriptions: subs.map((x) => ({
        id: x.id,
        email: x.email,
        name: x.shippingAddress.name,
        status: x.status,
        pausedBy: x.pausedBy,
        failures: x.failures,
        lastError: x.lastError,
        every: intervalLabel(x.intervalDays),
        percentOff: x.percentOff,
        nextOrderAt: x.nextOrderAt,
        items: x.lines.map((l) => `${l.quantity} × ${titles.get(l.variantId) ?? "A product no longer sold"}`),
        deliveries: x.deliveries,
        salesMinor: x.salesMinor,
        firstOrderId: x.firstOrderId,
        firstOrderNumber: x.firstOrderNumber,
      })),
    };
  },
  "POST subscriptions/:id": async ({ req, params, db, shop, user }) => {
    const b = await body<{ action?: unknown }>(req);
    if (b.action === "cancel") {
      const sub = await cancelSubscriptionForBuyer({ db, mailer: mailer() }, shop, params.id!);
      await logged({ shop, user, db }, `Cancelled ${sub.email}'s subscription in the app`, { href: "/admin/subscriptions" });
      return { ok: true, message: `Cancelled. We've emailed ${sub.email}.` };
    }
    if (b.action === "send_now") {
      // Test mode only: place the next delivery now, as if its day had come.
      if (!testPayments()) throw new HttpError(403, "Only in test mode.");
      const sub = await db.query.subscriptions.findFirst({ where: (x, { and, eq }) => and(eq(x.id, params.id!), eq(x.shopId, shop.id)), columns: { id: true } });
      if (!sub) throw new NotFoundError("Subscription");
      const r = await renewSubscription(await subscriptions(), sub.id);
      if (r.status === "ordered") return { ok: true, message: `Placed order #${r.order.number}.` };
      throw new UserError(r.status === "failed" ? `Couldn't place it: ${r.error}` : "It isn't active.");
    }
    throw new HttpError(400, "Pick cancel.");
  },
  // Emails and addresses checkout turns away: repeat chargebacks, stolen cards, return abuse.
  "GET blocked": async ({ db, shop }) => {
    const rows = await listBlockedBuyers(db, shop.id);
    const orders = new Map(
      rows.some((r) => r.orderId)
        ? (await db.query.orders.findMany({ where: (o, { inArray }) => inArray(o.id, rows.flatMap((r) => (r.orderId ? [r.orderId] : []))), columns: { id: true, number: true } })).map((o) => [o.id, o.number])
        : [],
    );
    return {
      blocked: rows.map((r) => ({ id: r.id, kind: r.kind, label: r.label, note: r.note, orderId: r.orderId, orderNumber: r.orderId ? (orders.get(r.orderId) ?? null) : null, createdAt: r.createdAt })),
    };
  },
  "POST blocked": async ({ req, db, shop, user }) => {
    const b = await body<{ email?: unknown; note?: unknown }>(req);
    const email = str(b.email).trim().toLowerCase();
    const added = await blockBuyer(db, shop.id, { email, note: str(b.note) });
    await logged({ shop, user, db }, `Blocked ${email} from checking out in the app`, { href: "/admin/blocked" });
    return { ok: true, message: added.length ? `${email} can't check out at your store any more.` : `${email} was already blocked.` };
  },
  "DELETE blocked/:id": async ({ params, db, shop, user }) => {
    const row = await unblockBuyer(db, shop.id, params.id!);
    await logged({ shop, user, db }, `Unblocked ${row.label} in the app`, { href: "/admin/blocked" });
    return { ok: true, message: `${row.label} can check out again.` };
  },
  // The team: who can help run the store, invites waiting, and the seats the plan includes.
  "GET team": async ({ db, shop, user }) => {
    const { members, invites } = await listTeam(db, shop.id);
    return {
      plan: PLANS[shop.plan].name,
      seats: teamSeats(shop.plan),
      used: members.filter((m) => m.role !== "owner").length + invites.length,
      roles: { admin: ROLES.admin.summary, staff: ROLES.staff.summary },
      members: members.map((m) => ({ userId: m.userId, email: m.email, name: m.name, role: m.role, since: m.since, you: m.userId === user.id })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt })),
    };
  },
  "POST team/invites": async ({ req, db, shop, user }) => {
    const b = await body<{ email?: unknown; role?: unknown }>(req);
    const email = str(b.email).trim().toLowerCase();
    const role = str(b.role);
    const base = platformUrl("/invite/");
    await inviteMember({ db, mailer: mailer(), brand: BRAND, inviteUrl: (t) => `${base}${t}` }, shop, user, { email, role });
    await logged({ shop, user, db }, `Invited ${email} as ${role === "admin" ? "admin" : "staff"} in the app`, { href: "/admin/team" });
    return { ok: true, message: `Invite sent to ${email}. The link works for a week.` };
  },
  "DELETE team/invites/:id": async ({ params, db, shop, user }) => {
    const invite = await db.query.shopInvites.findFirst({ where: (i, { and, eq }) => and(eq(i.id, params.id!), eq(i.shopId, shop.id)), columns: { email: true } });
    if (!invite) throw new NotFoundError("Invite");
    await cancelInvite(db, shop.id, params.id!);
    await logged({ shop, user, db }, `Cancelled the invite for ${invite.email} in the app`, { href: "/admin/team" });
    return { ok: true, message: `The invite for ${invite.email} no longer works.` };
  },
  "PATCH team/members/:id": async ({ req, params, db, shop, user }) => {
    const b = await body<{ role?: unknown }>(req);
    if (params.id === user.id) throw new UserError("You can't change your own role.");
    const role = str(b.role);
    await changeRole(db, shop.id, params.id!, role);
    const who = (await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, params.id!), columns: { email: true } }))?.email ?? "someone";
    await logged({ shop, user, db }, `Made ${who} ${role === "admin" ? "an admin" : "staff"} in the app`, { href: "/admin/team" });
    return { ok: true, message: `${who} is ${role === "admin" ? "an admin" : "staff"} now.` };
  },
  "DELETE team/members/:id": async ({ params, db, shop, user }) => {
    if (params.id === user.id) throw new UserError("To leave the store yourself, use Team on the website.");
    const who = (await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, params.id!), columns: { email: true } }))?.email ?? "someone";
    await removeMember(db, shop.id, params.id!);
    await logged({ shop, user, db }, `Removed ${who} from the team in the app`, { href: "/admin/team" });
    return { ok: true, message: `${who} can't open the store any more.` };
  },
  // Restock orders: stock the store keeps itself, ordered from a supplier and counted in when it arrives.
  "GET restock": async ({ db, shop }) => ({
    orders: (await listRestockOrders(db, shop.id)).slice(0, 50).map((o) => ({
      id: o.id,
      number: o.number,
      supplierName: o.supplierName,
      status: o.status,
      expectedOn: o.expectedOn,
      createdAt: o.createdAt,
      lines: o.lines,
      ordered: o.ordered,
      received: o.received,
      costMinor: o.costMinor,
    })),
  }),
  "GET restock/new": async ({ db, shop }) => ({
    choices: (await restockChoices(db, shop.id)).map((c) => ({ variantId: c.variantId, title: c.title, sku: c.sku, stock: c.stock, costMinor: c.costMinor })),
  }),
  "POST restock": async ({ req, db, shop, user }) => {
    const b = await body<Record<string, unknown>>(req);
    const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 200).map((l: { variantId?: unknown; quantity?: unknown; unitCostMinor?: unknown }) => ({
      variantId: str(l?.variantId),
      quantity: Number(l?.quantity),
      unitCostMinor: l?.unitCostMinor == null || l.unitCostMinor === "" ? null : Number(l.unitCostMinor),
    }));
    const order = await createRestockOrder(db, shop.id, { supplierName: str(b.supplierName), supplierEmail: str(b.supplierEmail), expectedOn: str(b.expectedOn), note: str(b.note), lines });
    await logged({ shop, user, db }, `Made restock order #${order.number} from ${order.supplierName} in the app`, { href: `/admin/restock/${order.id}` });
    return { ok: true, id: order.id, message: `Restock order #${order.number} is saved. Count it in here when it arrives.` };
  },
  "GET restock/:id": async ({ params, db, shop }) => {
    const o = await getRestockOrder(db, shop.id, params.id!);
    return {
      id: o.id,
      number: o.number,
      supplierName: o.supplierName,
      supplierEmail: o.supplierEmail,
      emailedAt: o.emailedAt,
      note: o.note,
      expectedOn: o.expectedOn,
      status: o.status,
      createdAt: o.createdAt,
      receivedAt: o.receivedAt,
      ordered: o.ordered,
      received: o.received,
      costMinor: o.costMinor,
      lines: o.lines.map((l) => ({ id: l.id, title: l.title, quantity: l.quantity, received: l.receivedQuantity, unitCostMinor: l.unitCostMinor, productId: l.productId })),
    };
  },
  "POST restock/:id/receive": async ({ req, params, db, shop, user }) => {
    const b = await body<{ lines?: unknown }>(req);
    const received = Array.isArray(b.lines) ? b.lines.map((l: { lineId?: unknown; quantity?: unknown }) => ({ lineId: str(l?.lineId), quantity: Number(l?.quantity) })) : undefined;
    const r = await receiveRestock(db, shop.id, params.id!, received);
    const o = await getRestockOrder(db, shop.id, params.id!);
    await logged({ shop, user, db }, `Counted ${r.added} in from restock order #${o.number} in the app`, { href: `/admin/restock/${o.id}` });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: r.done ? `Added ${r.added} to your stock. Everything on this order is in.` : `Added ${r.added} to your stock. The rest is still on the way.` };
  },
  "POST restock/:id/cancel": async ({ params, db, shop, user }) => {
    const o = await getRestockOrder(db, shop.id, params.id!);
    await cancelRestockOrder(db, shop.id, o.id);
    await logged({ shop, user, db }, `Cancelled restock order #${o.number} in the app`, { href: `/admin/restock/${o.id}` });
    return { ok: true, message: "Cancelled. Anything that already arrived stays in your stock." };
  },
  // A stock count: walk the shelves, type (or scan) what's there, and the stock is set to it.
  "GET stock-count": async ({ db, shop }) => ({
    options: (await restockChoices(db, shop.id)).map((c) => ({ variantId: c.variantId, title: c.title, sku: c.sku, barcode: c.barcode, location: c.location, stock: c.stock ?? 0 })),
  }),
  "POST stock-count": async ({ req, db, shop, user }) => {
    const b = await body<{ counts?: unknown }>(req);
    const counts = (Array.isArray(b.counts) ? b.counts : []).slice(0, 2000).map((c: { variantId?: unknown; counted?: unknown }) => ({ variantId: str(c?.variantId), counted: Number(c?.counted) }));
    const r = await recordStockCount(db, shop.id, counts);
    if (!r.changed) return { ok: true, message: "Everything matched. Nothing to change." };
    await logged({ shop, user, db }, `Counted stock in the app: ${r.changed === 1 ? "1 option" : `${r.changed} options`} changed`, { href: "/admin/inventory" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    const parts = [`Updated ${r.changed === 1 ? "1 option" : `${r.changed} options`}.`];
    if (r.missing) parts.push(`${r.missing} fewer than expected${r.missingCostMinor ? `, worth ${formatMoney(r.missingCostMinor, shop.currency)} at cost` : ""}.`);
    if (r.found) parts.push(`${r.found} more than expected.`);
    return { ok: true, message: parts.join(" ") };
  },
  // Supplier price rises: raise the price with the pricing rule, or keep it.
  "GET price-changes": async ({ db, shop }) => {
    const changes = await listCostChanges(db, shop);
    const products = testPayments()
      ? (await db.query.products.findMany({ where: (p, { and, eq, ne }) => and(eq(p.shopId, shop.id), ne(p.status, "archived"), eq(p.giftCard, false)), orderBy: (p, { asc }) => asc(p.title), limit: 50 })).map((p) => ({ id: p.id, title: p.title }))
      : [];
    return {
      minMarginPercent: shop.minMarginPercent,
      autoReprice: shop.autoReprice,
      changes: changes.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        costBeforeMinor: c.costBeforeMinor,
        costAfterMinor: c.costAfterMinor,
        priceMinor: c.status === "open" ? c.currentPriceMinor : c.priceMinor,
        newPriceMinor: c.newPriceMinor,
        suggestedPriceMinor: c.status === "open" && c.suggestedPriceMinor > c.currentPriceMinor ? c.suggestedPriceMinor : null,
        marginBefore: c.marginBefore,
        marginNow: c.marginNow,
        belowTarget: c.status === "open" && c.belowTarget,
        createdAt: c.createdAt,
      })),
      testProducts: products,
    };
  },
  "PUT price-changes/watch": async ({ req, db, shop, user }) => {
    const b = await body<{ minMarginPercent?: unknown; autoReprice?: unknown }>(req);
    const raw = str(b.minMarginPercent).trim();
    await setPriceWatch(db, shop.id, { minMarginPercent: raw ? Number(raw) : Number.NaN, autoReprice: b.autoReprice === true });
    await logged({ shop, user, db }, "Changed the price watch in the app", { href: "/admin/price-changes" });
    revalidatePath("/admin", "layout");
    return { ok: true, message: "Saved." };
  },
  "POST price-changes/simulate": async ({ req, db, shop }) => {
    if (!testPayments()) throw new HttpError(403, "Only in test mode.");
    const productId = str((await body<{ productId?: unknown }>(req)).productId);
    const variant = await db.query.variants.findFirst({
      where: (v, { and, eq, isNotNull }) => and(eq(v.productId, productId), isNotNull(v.costMinor)),
      orderBy: (v, { asc }) => asc(v.position),
    });
    const product = variant && (await db.query.products.findFirst({ where: (p, { and, eq }) => and(eq(p.id, productId), eq(p.shopId, shop.id)) }));
    if (!variant || !product) throw new UserError("Pick a product with a supplier cost.");
    await applySupplierCost(db, shop, variant.id, Math.max(variant.costMinor! + 1, Math.round(variant.priceMinor * 0.9)));
    return { ok: true };
  },
  "POST price-changes/:id": async ({ req, params, db, shop, user }) => {
    const action = (await body<{ action?: unknown }>(req)).action;
    if (action !== "raise" && action !== "keep") throw new UserError("Raise the price or keep it.");
    const row = await resolveCostChange(db, shop, params.id!, action);
    if (action === "raise") {
      await logged({ shop, user, db }, `Raised a price to ${formatMoney(row.newPriceMinor!, shop.currency)} after a supplier price rise, in the app`, { href: "/admin/price-changes" });
      revalidatePath(`/s/${shop.handle}`, "layout");
    }
    revalidatePath("/admin", "layout");
    return { ok: true, message: action === "raise" ? `Price raised to ${formatMoney(row.newPriceMinor!, shop.currency)}.` : "Price kept as it is." };
  },
  // Suppliers: how each is doing, and the wholesalers and makers you email orders to.
  "GET suppliers": async ({ db, shop }) => {
    const [own, scores] = await Promise.all([listOwnSuppliers(db, shop.id), supplierScorecard(db, shop.id)]);
    const available = suppliers().available;
    return {
      minOrders: SCORE_MIN_ORDERS,
      scores: scores.map((s) => ({
        id: s.supplier.id,
        name: supplierLabel(suppliers(), s.supplier),
        orders: s.orders,
        failed: s.failed,
        failedRate: s.failedRate,
        shipDays: s.shipDays,
        deliverDays: s.deliverDays,
        problems: s.problems,
        problemRate: s.problemRate,
        grade: s.grade,
        late: s.late,
        productsWithoutBackup: s.grade === "poor" || s.grade === "watch" ? s.productsWithoutBackup : 0,
      })),
      services: [
        { name: "cj", label: "CJ Dropshipping" },
        { name: "aliexpress", label: "AliExpress" },
      ].map((x) => ({ ...x, connected: available.some((a) => a.name === x.name) })),
      own: own.map((o) => ({ id: o.id, name: o.name!, email: o.contactEmail!, link: supplierPortalUrl(o.portalToken), products: o.products, openOrders: o.openOrders })),
    };
  },
  "POST suppliers": async ({ req, db, shop, user }) => {
    const b = await body<{ name?: unknown; email?: unknown }>(req);
    const row = await addOwnSupplier(db, shop.id, { name: str(b.name), email: str(b.email) });
    await logged({ shop, user, db }, `Added ${row.name} as a supplier in the app`, { href: "/admin/suppliers" });
    return { ok: true, message: `${row.name} added. Pick them as the supplier on their products on the website, and paid orders for those are emailed to them.` };
  },
  "PATCH suppliers/:id": async ({ req, params, db, shop }) => {
    const b = await body<{ name?: unknown; email?: unknown }>(req);
    const row = await updateOwnSupplier(db, shop.id, params.id!, { name: str(b.name), email: str(b.email) });
    return { ok: true, message: `${row.name} saved.` };
  },
  "POST suppliers/:id/new-link": async ({ params, db, shop }) => {
    const row = await resetSupplierLink(db, shop.id, params.id!);
    return { ok: true, message: `${row.name} has a new link. The old one no longer works, so send them this one.`, link: supplierPortalUrl(row.portalToken) };
  },
  "DELETE suppliers/:id": async ({ params, db, shop, user }) => {
    const own = (await listOwnSuppliers(db, shop.id)).find((o) => o.id === params.id);
    await removeOwnSupplier(db, shop.id, params.id!);
    await logged({ shop, user, db }, `Removed ${own?.name ?? "a supplier"} in the app`, { href: "/admin/suppliers" });
    return { ok: true, message: `${own?.name ?? "The supplier"} removed.` };
  },
  // Cart links: one link that fills a shopper's cart with chosen products (and a code), for a DM or a creator.
  "GET cart-links": async ({ db, shop }) => {
    const [links, choices, discounts, store] = await Promise.all([listCartLinks(db, shop.id), cartLinkChoices(db, shop.id), listDiscounts(db, shop.id), storeAddress(shop)]);
    return {
      max: CART_LINK_MAX_LINES,
      links: links.map((l) => ({
        id: l.id,
        name: l.name,
        url: `${store}/cart/link/${l.token}`,
        clicks: l.clicks,
        orders: l.orders,
        salesMinor: l.salesMinor,
        items: l.items.map((i) => ({ quantity: i.quantity, title: i.title, onSale: i.onSale })),
        discountCode: l.discountCode,
      })),
      options: choices.flatMap((p) => p.variants.map((v) => ({ id: v.id, title: v.title === "Default" ? p.title : `${p.title} – ${v.title}`, draft: p.draft }))),
      // Codes the merchant made or gave a partner; one-off batch, personal and reward codes aren't for sharing.
      codes: discounts.filter((d) => d.active && (d.source === "merchant" || d.source === "partner")).map((d) => d.code),
    };
  },
  "POST cart-links": async ({ req, db, shop, user }) => {
    const b = await body<{ name?: unknown; lines?: unknown; discountCode?: unknown }>(req);
    const lines = (Array.isArray(b.lines) ? b.lines : [])
      .slice(0, CART_LINK_MAX_LINES)
      .map((l: { variantId?: unknown; quantity?: unknown }) => ({ variantId: str(l?.variantId), quantity: Number(l?.quantity) || 1 }))
      .filter((l) => l.variantId);
    const link = await createCartLink(db, shop.id, { name: str(b.name), lines, discountCode: str(b.discountCode).trim() || null });
    await logged({ shop, user, db }, `Made the cart link “${link.name}” in the app`, { href: "/admin/cart-links" });
    return { ok: true, message: `“${link.name}” is ready. Share it anywhere.`, url: `${await storeAddress(shop)}/cart/link/${link.token}` };
  },
  "DELETE cart-links/:id": async ({ params, db, shop, user }) => {
    const link = (await listCartLinks(db, shop.id)).find((l) => l.id === params.id);
    if (!link) throw new NotFoundError("Cart link");
    await deleteCartLink(db, shop.id, link.id);
    await logged({ shop, user, db }, `Deleted the cart link “${link.name}” in the app`, { href: "/admin/cart-links" });
    return { ok: true, message: `“${link.name}” deleted. Its link no longer fills a cart.` };
  },
  // Wholesale: applications from businesses, approved buyers, and the discount they get.
  "GET wholesale": async ({ db, shop }) => {
    const buyers = await listWholesaleBuyers(db, shop.id);
    const view = (b: (typeof buyers)[number]) => ({ id: b.id, email: b.email, company: b.wholesaleCompany, taxId: b.wholesaleTaxId, message: b.wholesaleMessage, requestedAt: b.wholesaleRequestedAt });
    return {
      enabled: shop.wholesaleEnabled,
      percentOff: shop.wholesalePercentOff,
      minOrderMinor: shop.wholesaleMinOrderMinor,
      pending: buyers.filter((b) => b.wholesaleStatus === "pending").map(view),
      buyers: buyers.filter((b) => b.wholesaleStatus === "approved").map(view),
    };
  },
  "PUT wholesale": async ({ req, db, shop, user }) => {
    const b = await body<{ enabled?: unknown; percentOff?: unknown; minOrder?: unknown }>(req);
    const min = str(b.minOrder).trim().replace(/^[^\d]+/, "");
    let minOrderMinor = 0;
    if (min) {
      try {
        minOrderMinor = parseMoney(min);
      } catch {
        throw new UserError("Enter the smallest wholesale order as an amount, like 250.00, or leave it empty.");
      }
    }
    await setWholesaleSettings(db, shop.id, { enabled: b.enabled === true, percentOff: Number.parseInt(str(b.percentOff), 10) || 0, minOrderMinor });
    await logged({ shop, user, db }, "Changed the wholesale settings in the app", { href: "/admin/wholesale" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: "Wholesale settings saved." };
  },
  "POST wholesale/buyers": async ({ req, db, shop, user }) => {
    const b = await body<{ email?: unknown; company?: unknown }>(req);
    await addWholesaleBuyer(db, shop, { email: str(b.email), company: str(b.company) });
    await logged({ shop, user, db }, `Added ${str(b.company).trim() || str(b.email).trim()} as a wholesale buyer in the app`, { href: "/admin/wholesale" });
    return { ok: true, message: `${str(b.company).trim() || str(b.email).trim().toLowerCase()} gets wholesale prices once they sign in.` };
  },
  "POST wholesale/:id": async ({ req, params, db, shop, user }) => {
    const decision = (await body<{ decision?: unknown }>(req)).decision;
    if (decision !== "approve" && decision !== "decline" && decision !== "remove") throw new UserError("Approve, decline or remove.");
    const who = (await listWholesaleBuyers(db, shop.id)).find((b) => b.id === params.id);
    if (!who) throw new NotFoundError("Wholesale buyer");
    await decideWholesale(await campaigns(), shop, who.id, decision);
    const name = who.wholesaleCompany ?? who.email;
    const said = { approve: `Approved ${name} for wholesale`, decline: `Declined ${name}'s wholesale application`, remove: `Took wholesale prices away from ${name}` }[decision];
    await logged({ shop, user, db }, `${said} in the app`, { href: "/admin/wholesale" });
    return { ok: true, message: { approve: `${name} is approved. We emailed them.`, decline: `${name} is declined. We emailed them.`, remove: `${name} pays the normal prices again.` }[decision] };
  },
  // Partners: creators with their own code, the orders it brought, and what they're owed.
  "GET partners": async ({ db, shop, role }) => {
    const [partners, store] = await Promise.all([listPartners(db, shop.id), storeAddress(shop)]);
    const seesMoney = can(role, "money");
    return {
      seesMoney,
      holdDays: PARTNER_HOLD_DAYS,
      partners: partners.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        code: p.code,
        percentOff: p.percentOff,
        commission: formatRate(p.commissionBps),
        active: p.active,
        orders: p.orders,
        money: seesMoney ? { salesMinor: p.salesMinor, pendingMinor: p.pendingMinor, earnedMinor: p.earnedMinor, paidMinor: p.paidMinor, owedMinor: p.owedMinor } : null,
        shareUrl: `${store}/discount/${p.code}`,
        portalUrl: partnerPortalUrl(p.portalToken),
      })),
    };
  },
  "POST partners": async ({ req, db, shop, user }) => {
    const b = await body<Record<string, unknown>>(req);
    const store = await storeAddress(shop);
    const partner = await createPartner({ db, mailer: mailer(), partnerUrl: partnerPortalUrl, storeUrl: () => store }, shop, {
      name: str(b.name),
      email: str(b.email),
      code: str(b.code),
      percentOff: Number.parseInt(str(b.percentOff), 10) || 0,
      commissionPercent: Number.parseFloat(str(b.commission)) || 0,
    });
    await logged({ shop, user, db }, `Added partner ${partner.name} with the code ${partner.code} in the app`, { href: "/admin/partners" });
    return { ok: true, message: `${partner.name} is a partner with the code ${partner.code}.${partner.email ? " We emailed them their code and private page." : ""}` };
  },
  "POST partners/:id/payout": async ({ req, params, db, shop, user, role }) => {
    if (!can(role, "money")) throw new HttpError(403, "Your role on this store doesn't include money. The owner can change it.");
    const b = await body<{ amount?: unknown; note?: unknown }>(req);
    let amountMinor: number;
    try {
      amountMinor = parseMoney(str(b.amount).trim().replace(/^[^\d]+/, ""));
    } catch {
      throw new UserError("Enter the amount, like 25.00.");
    }
    const { partner, payout } = await recordPartnerPayout(db, shop, params.id!, { amountMinor, note: str(b.note) });
    const amount = formatMoney(payout.amountMinor, shop.currency);
    await logged({ shop, user, db }, `Recorded ${amount} paid to partner ${partner.name} in the app`, { href: "/admin/partners" });
    return { ok: true, message: `Recorded ${amount} paid to ${partner.name}.` };
  },
  "POST partners/:id": async ({ req, params, db, shop, user }) => {
    const action = (await body<{ action?: unknown }>(req)).action;
    if (action === "new_link") {
      const partner = await resetPartnerLink(db, shop.id, params.id!);
      await logged({ shop, user, db }, `Made a new private link for partner ${partner.name} in the app`, { href: "/admin/partners" });
      return { ok: true, message: `${partner.name} has a new private link. The old one stops working, so send them this one.` };
    }
    if (action !== "pause" && action !== "resume") throw new UserError("Pause, bring back, or make a new link.");
    const partner = await setPartnerActive(db, shop.id, params.id!, action === "resume");
    await logged({ shop, user, db }, `${action === "resume" ? "Brought back" : "Paused"} partner ${partner.name} in the app`, { href: "/admin/partners" });
    return { ok: true, message: action === "resume" ? `${partner.name}'s code works again.` : `${partner.name} is paused, so their code stops working. What they earned stays.` };
  },
  // Email campaigns: a short note to the people who said yes to emails, with how each one did.
  "GET campaigns": async ({ db, shop }) => {
    const [rows, sizes, allowance] = await Promise.all([listCampaigns(db, shop.id), audienceSizes(db, shop.id), campaignAllowance(db, shop.id)]);
    return {
      left: allowance.left,
      limit: allowance.limit,
      hasAddress: !!shop.mailingAddress?.trim(),
      // Audiences that need a tag or a product picked stay on the website.
      audiences: (["subscribers", "customers", "not_bought", "lapsed"] as const).map((a) => ({ value: a, label: AUDIENCE_LABELS[a], size: sizes[a] })),
      campaigns: rows.map((c) => ({
        id: c.id,
        subject: c.subject,
        body: c.body,
        status: c.status,
        audience: c.audience,
        audienceLabel: AUDIENCE_LABELS[c.audience],
        scheduledFor: c.scheduledFor,
        stats: { sent: c.stats.sent, clicks: c.stats.clicks, orders: c.stats.orders, salesMinor: c.stats.salesMinor },
      })),
    };
  },
  "PUT campaigns/address": async ({ req, db, shop }) => {
    await setMailingAddress(db, shop.id, str((await body<{ mailingAddress?: unknown }>(req)).mailingAddress));
    return { ok: true, message: "Mailing address saved. It goes at the foot of every campaign." };
  },
  "POST campaigns": async ({ req, db, shop, user }) => {
    const b = await body<Record<string, unknown>>(req);
    const audience = (["subscribers", "customers", "not_bought", "lapsed"] as const).find((a) => a === b.audience) ?? "subscribers";
    const c = await createCampaign(db, shop.id, user.id, { subject: str(b.subject), body: str(b.body), buttonLabel: str(b.buttonLabel), buttonPath: str(b.buttonPath), audience });
    return { ok: true, id: c.id, message: "Draft saved. Send yourself a test, then send it." };
  },
  "POST campaigns/:id/test": async ({ req, params, shop, user }) => {
    const to = str((await body<{ to?: unknown }>(req)).to).trim() || user.email;
    await sendTestCampaign(await campaigns(), shop, params.id!, to);
    return { ok: true, message: `Test sent to ${to.toLowerCase()}.` };
  },
  "POST campaigns/:id/send": async ({ params, shop, user, db }) => {
    const ctx = await campaigns();
    const c = await startCampaign(ctx, shop, params.id!);
    after(() => sendCampaignBatches(ctx).then(() => {}));
    await logged({ shop, user, db }, `Sent the campaign “${c.subject}” from the app`, { href: `/admin/campaigns/${c.id}` });
    return { ok: true, message: `Sending to ${c.recipients === 1 ? "1 person" : `${c.recipients} people`}. Results show here as they open and buy.` };
  },
  "DELETE campaigns/:id": async ({ params, db, shop }) => {
    await deleteCampaign(db, shop.id, params.id!);
    return { ok: true, message: "Draft deleted." };
  },
  // The buyer survey: "How did you hear about us?" on the order page, and what buyers answered.
  "GET survey": async ({ url, db, shop }) => {
    const days = [30, 90, 365].find((d) => String(d) === url.searchParams.get("days")) ?? 30;
    const r = await surveyReport(db, shop.id, days);
    return { survey: shop.survey, days, orders: r.orders, answered: r.answered, rows: r.rows, others: r.others };
  },
  "PUT survey": async ({ req, db, shop, user }) => {
    const b = await body<{ on?: unknown; question?: unknown; options?: unknown; other?: unknown }>(req);
    const on = b.on !== false;
    await setSurvey(db, shop.id, on ? { question: str(b.question), options: (Array.isArray(b.options) ? b.options : []).map((o) => str(o)), other: b.other === true } : null);
    await logged({ shop, user, db }, on ? "Saved the buyer survey in the app" : "Turned off the buyer survey in the app", { href: "/admin/survey" });
    return { ok: true, message: on ? "Saved. Buyers see the question on their order page right after paying." : "The survey is off. Answers so far stay here." };
  },
  // Rewards: points on what buyers pay, swapped for store credit.
  "GET rewards": async ({ db, shop }) => {
    const summary = await rewardsSummary(db, shop);
    return {
      enabled: shop.rewardsEnabled,
      earnRate: shop.rewardsEarnRate,
      value: (shop.rewardsValueMinor / 100).toFixed(2),
      describe: describeRewards(shop),
      members: summary.members,
      points: summary.points,
      owedMinor: summary.owedMinor,
      redeemedPoints: summary.redeemedPoints,
      top: summary.top.map((r) => ({ customerId: r.customerId, name: r.name || r.email, points: r.points })),
    };
  },
  "PUT rewards": async ({ req, db, shop, user }) => {
    const b = await body<{ enabled?: unknown; earnRate?: unknown; value?: unknown }>(req);
    let valueMinor: number;
    try {
      valueMinor = parseMoney(str(b.value).trim().replace(/^[^\d]+/, ""));
    } catch {
      throw new UserError("Enter what 100 points are worth, like 1.00.");
    }
    await setRewardsSettings(db, shop.id, { enabled: b.enabled === true, earnRate: Number.parseInt(str(b.earnRate), 10) || 0, valueMinor });
    await logged({ shop, user, db }, "Changed the rewards settings in the app", { href: "/admin/rewards" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: b.enabled === true ? "Rewards saved. Buyers earn points from their next order." : "Rewards are off. Points buyers have stay theirs." };
  },
  "GET customers/:id/points": async ({ params, db, shop }) => {
    await getCustomerProfile(db, shop.id, params.id!);
    return { enabled: shop.rewardsEnabled, points: await customerPoints(db, params.id!) };
  },
  "POST customers/:id/points": async ({ req, params, db, shop, user }) => {
    const b = await body<{ points?: unknown; note?: unknown }>(req);
    const points = Number(str(b.points).replace(/[\s,]/g, ""));
    const balance = await adjustPoints(db, shop.id, params.id!, { points, note: str(b.note) });
    await logged({ shop, user, db }, `${points > 0 ? "Added" : "Took away"} ${Math.abs(points).toLocaleString("en-US")} reward points in the app`, { href: `/admin/customers/${params.id}` });
    return { ok: true, points: balance, message: `Saved. They have ${balance.toLocaleString("en-US")} points now.` };
  },
  // Bank transfers: orders waiting for the buyer's transfer, and the account details buyers pay into.
  "GET bank-transfers": async ({ db, shop, role }) => {
    const waiting = (await listOrders(db, shop.id))
      .filter((o) => o.manualPayment === "bank_transfer" && o.paymentStatus === "pending")
      .sort((a, b) => (a.manualPaymentAt?.getTime() ?? 0) - (b.manualPaymentAt?.getTime() ?? 0))
      .slice(0, 200);
    return {
      on: !!shop.bankTransfer && shop.plan !== "free",
      details: shop.bankTransfer?.details ?? "",
      days: shop.bankTransfer?.days ?? TRANSFER_DAYS.default,
      limits: { ...TRANSFER_DAYS, detailsMax: BANK_DETAILS_MAX },
      freePlan: shop.plan === "free",
      canEdit: can(role, "money"),
      waiting: waiting.map((o) => ({ ...orderSummary(o), dueBy: transferDueBy(shop, o) })),
    };
  },
  "PUT bank-transfers": async ({ req, db, shop, user }) => {
    const b = await body<{ on?: unknown; details?: unknown; days?: unknown }>(req);
    const on = b.on === true;
    await setBankTransfer(db, shop, on ? { details: str(b.details), days: Number(b.days) } : null);
    await logged({ shop, user, db }, on ? "Turned on bank transfers in the app" : "Turned off bank transfers in the app", { href: "/admin/orders?show=transfers" });
    return { ok: true, message: on ? "Saved. Buyers can now pay by bank transfer on the payment page." : "Saved. Buyers pay by card only." };
  },
  "POST orders/:id/transfer-paid": async ({ params, db, shop, user }) => {
    const o = await getOrder(db, shop.id, params.id!);
    const paid = await markTransferPaid(db, shop.id, o.id);
    if (!paid) return { ok: true, message: "This order is already paid." };
    afterOrderPaid(o.id);
    await logged({ shop, user, db }, "Marked the bank transfer for order {order} as paid in the app", { orderId: o.id });
    return { ok: true, message: "Marked as paid. It goes to the supplier now, and the buyer gets their confirmation." };
  },
  // Saved replies: the store's own answers to what buyers ask most, put into an inbox reply with a tap.
  "GET saved-replies": async ({ db, shop }) => {
    const replies = await listSavedReplies(db, shop.id);
    const have = new Set(replies.map((r) => r.title.toLowerCase()));
    return {
      replies: replies.map((r) => ({ id: r.id, title: r.title, body: r.body })),
      fields: Object.entries(REPLY_FIELDS).map(([field, means]) => ({ field, means })),
      max: MAX_SAVED_REPLIES,
      startersMissing: STARTER_REPLIES.filter((r) => !have.has(r.title.toLowerCase())).length,
    };
  },
  "POST saved-replies": async ({ req, db, shop }) => {
    const b = await body<{ id?: unknown; title?: unknown; body?: unknown }>(req);
    const reply = await saveSavedReply(db, shop.id, { id: str(b.id) || undefined, title: str(b.title), body: str(b.body) });
    return { ok: true, id: reply.id, message: `Saved "${reply.title}".` };
  },
  "POST saved-replies/starters": async ({ db, shop }) => {
    const n = await addStarterReplies(db, shop.id);
    return { ok: true, message: n ? `Added ${n === 1 ? "1 reply" : `${n} replies`} to start from. Change them to sound like you.` : "You already have them." };
  },
  "DELETE saved-replies/:id": async ({ params, db, shop }) => {
    await deleteSavedReply(db, shop.id, params.id!);
    return { ok: true, message: "Deleted." };
  },
  // Bundles: products sold together for less, with one button on each product's page to add them all.
  "GET bundles": async ({ db, shop }) => {
    const [bundles, choices] = await Promise.all([listBundles(db, shop.id), bundleProductChoices(db, shop.id)]);
    return {
      bundles: bundles.map((b) => ({ id: b.id, title: b.title, percentOff: b.percentOff, active: b.active, live: b.live, products: b.products.map((p) => ({ id: p.id, title: p.title })) })),
      choices: choices.map((p) => ({ id: p.id, title: p.title, draft: p.status !== "active" })),
      max: MAX_BUNDLES,
      maxPercent: MAX_BUNDLE_PERCENT,
    };
  },
  "POST bundles": async ({ req, db, shop, user }) => {
    const b = await body<{ title?: unknown; productIds?: unknown; percentOff?: unknown }>(req);
    const productIds = (Array.isArray(b.productIds) ? b.productIds : []).map(str).filter(Boolean).slice(0, 10);
    const bundle = await createBundle(db, shop.id, { title: str(b.title), productIds, percentOff: str(b.percentOff).trim() });
    await logged({ shop, user, db }, `Added the bundle ${bundle.title} in the app`, { href: "/admin/bundles" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: "Bundle added. It shows on each of its products' pages." };
  },
  "POST bundles/:id": async ({ req, params, db, shop }) => {
    const b = await body<{ active?: unknown }>(req);
    await setBundleActive(db, shop.id, params.id!, b.active === true);
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: b.active === true ? "Bundle switched on." : "Bundle switched off. It's hidden from your store." };
  },
  "DELETE bundles/:id": async ({ params, db, shop }) => {
    await deleteBundle(db, shop.id, params.id!);
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: "Bundle deleted." };
  },
  // Tag rules: a tag every customer who matches gets ("spent $200 or more" gets vip), and loses when they stop matching.
  "GET tag-rules": async ({ db, shop }) => {
    const [rules, products] = await Promise.all([listTagRules(db, shop.id), listActiveProducts(db, shop.id)]);
    return {
      rules: rules.map((r) => ({ id: r.id, tag: r.tag, describe: describeTagRule(r, shop.currency, r.productTitle), customers: r.customers })),
      max: MAX_TAG_RULES,
      products: products.filter((p) => !p.giftCard).map((p) => ({ id: p.id, title: p.title })),
    };
  },
  "POST tag-rules": async ({ req, db, shop, user }) => {
    const b = await body<Record<string, unknown>>(req);
    const kind = str(b.kind);
    const tag = str(b.tag);
    const whole = (v: unknown) => Number.parseInt(str(v).trim() || "0", 10) || 0;
    const input: TagRuleInput =
      kind === "bought"
        ? { kind, tag, productId: str(b.productId) }
        : kind === "orders"
          ? { kind, tag, threshold: whole(b.orders) }
          : kind === "lapsed"
            ? { kind, tag, threshold: whole(b.days) }
            : { kind: "spent", tag, threshold: parseMoney(str(b.amount).trim().replace(/^[^\d]+/, "") || "0") };
    const { rule, applied } = await createTagRule(db, shop.id, input);
    await logged({ shop, user, db }, `Added the tag rule for "${rule.tag}" in the app`, { href: "/admin/customers#tag-rules" });
    const n = applied?.tagged ?? 0;
    return { ok: true, message: n === 0 ? "Added. Nobody matches it yet." : `Added. ${n} ${n === 1 ? "customer now has" : "customers now have"} the tag “${rule.tag}”.` };
  },
  "DELETE tag-rules/:id": async ({ params, db, shop, user }) => {
    const { rule } = await deleteTagRule(db, shop.id, params.id!);
    await logged({ shop, user, db }, `Removed the tag rule for "${rule.tag}" in the app`, { href: "/admin/customers#tag-rules" });
    return { ok: true, message: `Removed. Customers it tagged lose “${rule.tag}”, unless you gave it by hand.` };
  },
  // One-time codes: a batch of codes that each work once, for parcel cards, influencer boxes or a pop-up stand.
  "GET code-batches": async ({ db, shop }) => {
    const batches = await listCodeBatches(db, shop.id);
    return {
      max: MAX_BATCH,
      batches: batches.map((b) => ({
        id: b.id,
        name: b.name,
        prefix: b.prefix,
        count: b.count,
        used: b.used,
        active: b.active,
        offer: b.kind === "free_shipping" ? "Free shipping" : b.kind === "percent" ? `${b.value}% off` : `${formatMoney(b.value, shop.currency)} off`,
        minSubtotalMinor: b.minSubtotalMinor,
        endsAt: b.endsAt,
      })),
    };
  },
  "POST code-batches": async ({ req, db, shop, user }) => {
    const b = await body<Record<string, unknown>>(req);
    const kind = (["percent", "amount", "free_shipping"] as const).find((k) => k === b.kind) ?? "percent";
    const raw = str(b.value).trim().replace(/^[^\d]+/, "");
    const min = str(b.minSubtotal).trim().replace(/^[^\d]+/, "");
    const ends = str(b.endsAt).trim();
    const endsAt = ends ? new Date(`${ends}T23:59:59Z`) : null;
    if (endsAt && Number.isNaN(endsAt.getTime())) throw new UserError("Enter dates as YYYY-MM-DD.");
    const batch = await createCodeBatch(db, shop.id, {
      name: str(b.name),
      prefix: str(b.prefix),
      count: Number.parseInt(str(b.count) || "0", 10) || 0,
      kind,
      value: kind === "percent" ? Number.parseInt(raw || "0", 10) : kind === "amount" ? parseMoney(raw || "0") : 0,
      minSubtotalMinor: min ? parseMoney(min) : 0,
      endsAt,
    });
    await logged({ shop, user, db }, `Made ${batch.count} one-time codes (${batch.name}) in the app`, { href: "/admin/marketing#one-time-codes" });
    return { ok: true, id: batch.id, message: `Made ${batch.count === 1 ? "1 code" : `${batch.count} codes`}. Each one works once.` };
  },
  "POST code-batches/:id": async ({ req, params, db, shop, user }) => {
    const b = await body<{ active?: unknown }>(req);
    const batch = await setCodeBatchActive(db, shop.id, params.id!, b.active === true);
    await logged({ shop, user, db }, `${batch.active ? "Turned on" : "Turned off"} the one-time codes ${batch.name} in the app`, { href: "/admin/marketing#one-time-codes" });
    return { ok: true, message: batch.active ? `${batch.name} codes work again.` : `${batch.name} codes are off. Codes already used stay used.` };
  },
  "GET code-batches/:id/codes": async ({ params, db, shop }) => {
    // The spreadsheet's rows: Code, Used, Order, Used on. Codes are letters, numbers and a dash, so no quoting.
    const { csv } = await codeBatchCsv(db, shop.id, params.id!);
    const rows = csv.trim().split("\n").slice(1).map((l) => l.split(","));
    return { codes: rows.map(([code, used, order]) => ({ code: code!, used: used === "yes", order: order || null })), csv };
  },
  // A shipping pause: the supplier is closed for a while, orders keep coming, and every page says when they ship.
  "GET ship-pause": async ({ shop }) => ({
    pause: shop.shipPause,
    active: !!activeShipPause(shop),
    maxDays: SHIP_PAUSE_MAX_DAYS,
    messageMax: SHIP_PAUSE_MESSAGE_MAX,
  }),
  "PUT ship-pause": async ({ req, db, shop, user }) => {
    const b = await body<{ on?: unknown; from?: unknown; resumesOn?: unknown; message?: unknown }>(req);
    const saved = await setShipPause(db, shop.id, b.on === true ? { from: str(b.from), resumesOn: str(b.resumesOn), message: str(b.message) } : null);
    await logged({ shop, user, db }, saved ? `Paused shipping until ${saved.resumesOn} in the app` : "Ended the shipping pause in the app", { href: "/admin/shipping#pause-heading" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: saved ? "Saved. Your store says when orders ship again, and delivery dates move to match." : "Shipping pause ended. Delivery dates are back to normal." };
  },
  // Running late: one email to a buyer whose order hasn't shipped after some days, and when a parcel is past its date.
  "GET late-emails": async ({ shop }) => ({
    notice: shop.lateOrderNotice,
    days: LATE_ORDER_DAYS,
    messageMax: LATE_ORDER_MESSAGE_MAX,
  }),
  "PUT late-emails": async ({ req, db, shop, user }) => {
    const b = await body<{ on?: unknown; days?: unknown; message?: unknown; transit?: unknown }>(req);
    const saved = await setLateOrderNotice(db, shop.id, b.on === true ? { days: Number(b.days), message: str(b.message), transit: b.transit === true } : null);
    await logged({ shop, user, db }, saved ? `Turned on "running late" emails after ${saved.days} days${saved.transit ? " and for parcels past their delivery date" : ""} in the app` : `Turned off "running late" emails in the app`, { href: "/admin/shipping#late-heading" });
    return { ok: true, message: saved ? `Saved. Buyers hear from you once if their order hasn't shipped after ${saved.days} days.` : "Running late emails are off." };
  },
  // A holiday order-by date: product pages say "Order by Dec 15 to get it in time for Christmas".
  "GET holiday-date": async ({ shop }) => ({ deadline: shop.holidayDeadline, nameMax: HOLIDAY_NAME_MAX }),
  "PUT holiday-date": async ({ req, db, shop, user }) => {
    const b = await body<{ on?: unknown; name?: unknown; arriveBy?: unknown }>(req);
    const saved = await setHolidayDeadline(db, shop.id, b.on === true ? { name: str(b.name), arriveBy: str(b.arriveBy) } : null);
    await logged({ shop, user, db }, saved ? `Set an order-by date for ${saved.name} in the app` : "Removed the holiday order-by date in the app", { href: "/admin/shipping#holiday-heading" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    const day = saved ? new Date(`${saved.arriveBy}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";
    return { ok: true, message: saved ? `Saved. Product pages say when to order for ${saved.name}, arriving by ${day}.` : "Removed. Product pages no longer give an order-by date." };
  },
  // Gift wrapping: buyers sending a gift can have it wrapped at checkout, for the price set here.
  "GET gift-wrap": async ({ shop }) => ({ wrap: shop.giftWrap, noteMax: MAX_GIFT_WRAP_NOTE }),
  "PUT gift-wrap": async ({ req, db, shop, user }) => {
    const b = await body<{ on?: unknown; price?: unknown; note?: unknown }>(req);
    let saved = null;
    if (b.on === true) {
      // A currency sign in front is fine; letters aren't.
      const raw = str(b.price).trim().replace(/^[$€£¥₹]\s*/, "");
      let priceMinor = 0;
      try {
        priceMinor = raw ? parseMoney(raw) : 0;
      } catch {
        throw new UserError("Enter the wrapping price as an amount, like 4.00.");
      }
      saved = await setGiftWrap(db, shop.id, { priceMinor, note: str(b.note) });
    } else {
      await setGiftWrap(db, shop.id, null);
    }
    await logged({ shop, user, db }, saved ? `Turned on gift wrapping at ${formatMoney(saved.priceMinor, shop.currency)} in the app` : "Turned off gift wrapping in the app", { href: "/admin/shipping#gift-wrap" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: saved ? "Saved. Buyers sending a gift can have it wrapped." : "Saved. Checkout doesn't offer gift wrapping." };
  },
  // New subscribers: the welcome offer they get by email, and the pop-up that asks for their email.
  "GET signup": async ({ shop }) => ({
    welcome: shop.welcomeOffer,
    welcomeText: shop.welcomeOffer ? describeWelcomeOffer(shop.welcomeOffer, shop.currency) : null,
    popupSeconds: shop.signupPopupSeconds,
    popupOptions: [SIGNUP_POPUP_ON_LEAVE, ...SIGNUP_POPUP_SECONDS],
    onLeave: SIGNUP_POPUP_ON_LEAVE,
  }),
  "PUT signup/welcome": async ({ req, db, shop, user }) => {
    const b = await body<{ on?: unknown; percentOff?: unknown; minSubtotal?: unknown; days?: unknown }>(req);
    const int = (v: unknown) => Number.parseInt(str(v).trim() || "NaN", 10);
    let minSubtotalMinor = 0;
    const min = str(b.minSubtotal).trim().replace(/^[$€£¥₹]\s*/, "");
    if (b.on === true && min) {
      try {
        minSubtotalMinor = parseMoney(min);
      } catch {
        throw new UserError("Enter the smallest order as an amount, like 50.00, or leave it empty.");
      }
    }
    const offer = await setWelcomeOffer(db, shop.id, b.on === true ? { percentOff: int(b.percentOff), minSubtotalMinor, days: int(b.days) } : null);
    await logged({ shop, user, db }, offer ? `Set the welcome offer to ${describeWelcomeOffer(offer, shop.currency)} in the app` : "Turned off the welcome offer in the app", { href: "/admin/marketing" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: offer ? `Saved. New subscribers get ${describeWelcomeOffer(offer, shop.currency)}, in a code that lasts ${offer.days} days.` : "Saved. New subscribers don't get a code." };
  },
  "PUT signup/popup": async ({ req, db, shop, user }) => {
    const b = await body<{ seconds?: unknown }>(req);
    const raw = b.seconds === null || b.seconds === undefined || b.seconds === "" ? null : Number(b.seconds);
    const seconds = await setSignupPopup(db, shop.id, raw);
    await logged({ shop, user, db }, seconds === null ? "Turned off the sign-up pop-up in the app" : "Turned on the sign-up pop-up in the app", { href: "/admin/marketing#popup-heading" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return {
      ok: true,
      message: seconds === null ? "Saved. Visitors aren't asked for their email in a pop-up." : seconds === SIGNUP_POPUP_ON_LEAVE ? "Saved. Visitors are asked for their email when they look about to leave." : `Saved. Visitors are asked for their email ${seconds} seconds after they arrive.`,
    };
  },
  // Holiday returns: orders paid in a stretch (Nov 1 to Dec 24) can come back until a later day (Jan 31).
  "GET holiday-returns": async ({ shop }) => {
    const now = new Date();
    // Suggested dates: this season, or next year's once this one's last order day has passed.
    const y = now.getUTCMonth() === 11 && now.getUTCDate() > 24 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    return {
      holiday: shop.holidayReturns,
      windowDays: shop.returnWindowDays,
      suggested: { from: `${y}-11-01`, to: `${y}-12-24`, until: `${y + 1}-01-31` },
    };
  },
  "PUT holiday-returns": async ({ req, db, shop, user }) => {
    const b = await body<{ on?: unknown; from?: unknown; to?: unknown; until?: unknown }>(req);
    const saved = await setHolidayReturns(db, shop, b.on === true ? { from: str(b.from), to: str(b.to), until: str(b.until) } : null);
    await logged({ shop, user, db }, saved ? `Kept holiday orders returnable until ${saved.until} in the app` : "Turned off holiday returns in the app", { href: "/admin/returns#holiday-returns" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return {
      ok: true,
      message: saved
        ? `Saved. Orders paid ${day(saved.from)} to ${day(saved.to)} can be returned until ${day(saved.until)}.`
        : `Saved. Every order has your usual ${shop.returnWindowDays} days to come back.`,
    };
  },
  // Delivery dates: product pages, the cart, checkout and receipts say when orders arrive.
  "GET delivery-dates": async ({ shop }) => ({ on: shop.deliveryEstimates, processingDays: shop.processingDays }),
  "PUT delivery-dates": async ({ req, db, shop, user }) => {
    const b = await body<{ on?: unknown; processingDays?: unknown }>(req);
    const days = str(b.processingDays).trim();
    const saved = await setDeliveryEstimates(db, shop.id, { enabled: b.on === true, processingDays: days === "" ? Number.NaN : Number(days) });
    await logged({ shop, user, db }, saved.enabled ? `Turned on delivery dates, ${saved.processingDays} days to get ready, in the app` : "Turned off delivery dates in the app", { href: "/admin/shipping#delivery-heading" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: saved.enabled ? "Saved. Product pages, the cart and receipts say when orders arrive." : "Saved. Buyers don't see delivery dates." };
  },
  // The store's look: the draft is designed on the website; here it's published now or scheduled.
  "GET store-look": async ({ db, shop }) => {
    const t = await getTheme(db, shop);
    return { hasChanges: t.hasChanges, publishedAt: t.publishedAt, schedule: t.schedule, revertAt: t.revertAt };
  },
  "POST store-look/publish": async ({ db, shop, user }) => {
    await publishTheme(db, shop);
    await logged({ shop, user, db }, "Published changes to the store's look in the app", { href: "/admin/theme" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: "Published. Buyers see the new look now." };
  },
  "PUT store-look/schedule": async ({ req, db, shop, user }) => {
    const b = await body<{ at?: unknown; until?: unknown }>(req);
    const until = str(b.until).trim();
    const saved = await scheduleTheme(db, shop, { at: new Date(str(b.at)), until: until ? new Date(until) : null });
    await logged({ shop, user, db }, "Scheduled a new look for the store in the app", { href: "/admin/theme" });
    return { ok: true, schedule: saved, message: saved.until ? "Scheduled. The new look goes live by itself and switches back when you said." : "Scheduled. The new look goes live by itself." };
  },
  "DELETE store-look/schedule": async ({ db, shop, user }) => {
    await cancelThemeSchedule(db, shop.id);
    await logged({ shop, user, db }, "Cancelled the store's scheduled look in the app", { href: "/admin/theme" });
    return { ok: true, message: "Cancelled. The store keeps the look it has." };
  },
  "POST store-look/keep": async ({ db, shop, user }) => {
    await keepScheduledTheme(db, shop.id);
    await logged({ shop, user, db }, "Kept the store's scheduled look instead of switching back, in the app", { href: "/admin/theme" });
    return { ok: true, message: "Kept. This look stays until you change it." };
  },
  // Search fixes: words shoppers searched for that found nothing, pointed at words that do. The
  // last 30 days' searches that found nothing are listed so one can be fixed with a tap.
  "GET search-fixes": async ({ db, shop }) => {
    const now = new Date();
    const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 86_400_000;
    const report = await searchReport(db, shop.id, { from: new Date(to - 30 * 86_400_000), to: new Date(to) });
    const fixed = new Set(shop.searchFixes.map((f) => f.from));
    return {
      fixes: shop.searchFixes,
      nothing: report.nothing.filter((t) => !fixed.has(t.term)).map((t) => ({ term: t.term, searches: t.searches })),
      max: SEARCH_TERM_MAX,
      maxFixes: MAX_SEARCH_FIXES,
    };
  },
  "PUT search-fixes": async ({ req, db, shop, user }) => {
    const b = await body<{ from?: unknown; to?: unknown }>(req);
    const fixes = await setSearchFix(db, shop.id, { from: str(b.from), to: str(b.to) });
    const from = str(b.from).toLowerCase().replace(/\s+/g, " ").trim();
    const fix = fixes.find((f) => f.from === from);
    await logged({ shop, user, db }, `Pointed searches for “${from}” at “${fix?.to ?? ""}” in the app`, { href: "/admin/search-fixes" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: `Saved. Searching “${from}” now shows the results for “${fix?.to ?? ""}”.` };
  },
  "DELETE search-fixes/:from": async ({ params, db, shop, user }) => {
    const from = params.from!;
    if (!shop.searchFixes.some((f) => f.from === from)) throw new UserError("That search fix is already gone.");
    await removeSearchFix(db, shop.id, from);
    await logged({ shop, user, db }, `Removed the search fix for “${from}” in the app`, { href: "/admin/search-fixes" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: `Removed. Searching “${from}” shows its own results again.` };
  },
  // The blog: posts listed newest change first, written and published from the phone. Photos,
  // featured products and the AI writer stay on the website; saving here keeps what's set there.
  "GET blog": async ({ db, shop }) => {
    const [posts, store] = await Promise.all([listPosts(db, shop.id), storeAddress(shop)]);
    return { posts: posts.map((p) => blogPostView(p, store)) };
  },
  "GET blog/:id": async ({ params, db, shop }) => {
    const [post, store] = await Promise.all([getPost(db, shop.id, params.id!), storeAddress(shop)]);
    return { post: { ...blogPostView(post, store), body: post.body, excerpt: post.excerpt ?? "", tags: post.tags.join(", "), hasImage: !!post.imageUrl, productCount: post.productIds.length }, topicsMax: POST_TAGS_MAX };
  },
  "POST blog": async ({ req, db, shop, user }) => {
    const b = await body<{ title?: unknown; body?: unknown; excerpt?: unknown; tags?: unknown }>(req);
    const post = await createPost(db, shop.id, { title: str(b.title), body: str(b.body), excerpt: str(b.excerpt), tags: str(b.tags) });
    await logged({ shop, user, db }, `Started the blog post “${post.title}” in the app`, { href: `/admin/blog/${post.id}` });
    return { ok: true, id: post.id, message: "Saved as a draft. Only you can see it until it's published." };
  },
  "PUT blog/:id": async ({ req, params, db, shop }) => {
    const b = await body<{ title?: unknown; body?: unknown; excerpt?: unknown; tags?: unknown }>(req);
    const post = await getPost(db, shop.id, params.id!);
    // The address, photo and featured products are kept as they are.
    await updatePost(db, shop.id, post.id, { title: str(b.title), body: str(b.body), excerpt: str(b.excerpt), tags: str(b.tags), handle: post.handle, imageUrl: post.imageUrl ?? "", productIds: post.productIds });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: post.status === "published" && !isScheduled(post) ? "Saved. The post on your store shows the changes." : "Saved." };
  },
  "POST blog/:id/publish": async ({ req, params, db, shop, user }) => {
    // "Publish now" sends no body; a time to publish at comes as { at }.
    const b = req.headers.get("content-type")?.includes("json") ? await body<{ at?: unknown }>(req) : {};
    const raw = str(b.at).trim();
    const at = raw ? new Date(raw) : null;
    if (at && Number.isNaN(at.getTime())) throw new UserError("Pick a date and time to publish.");
    const post = await setPostPublished(db, shop.id, params.id!, true, new Date(), at);
    const later = isScheduled(post);
    await logged({ shop, user, db }, later ? `Scheduled the blog post “${post.title}” in the app` : `Published the blog post “${post.title}” in the app`, { href: `/admin/blog/${post.id}` });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: later ? "Scheduled. The post goes up on your store by itself." : "Published. The post is on your store's blog." };
  },
  "POST blog/:id/unpublish": async ({ params, db, shop, user }) => {
    const before = await getPost(db, shop.id, params.id!);
    const waiting = isScheduled(before);
    const post = await setPostPublished(db, shop.id, before.id, false);
    await logged({ shop, user, db }, `Took the blog post “${post.title}” back to a draft in the app`, { href: `/admin/blog/${post.id}` });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: waiting ? "Unscheduled. The post stays a draft." : "Unpublished. The post is a draft again and off your store." };
  },
  "DELETE blog/:id": async ({ params, db, shop, user }) => {
    const post = await getPost(db, shop.id, params.id!);
    await deletePost(db, shop.id, post.id);
    await logged({ shop, user, db }, `Deleted the blog post “${post.title}” in the app`, { href: "/admin/blog" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: `Deleted “${post.title}”.` };
  },
  // The store's standing with us: warnings and pauses with the reason, what to do and a deadline,
  // appeals and their replies, and the verified badge's checklist. Opening it marks notices read.
  "GET trust": async ({ db, shop }) => {
    const [notices, check] = await Promise.all([listNotices(db, shop.id), verifiedChecklist(db, shop)]);
    await markNoticesRead(db, shop.id);
    const open = notices.filter((n) => !n.closedAt);
    return {
      paused: shop.status !== "active",
      open: open.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        explanation: n.explanation,
        whatToDo: n.whatToDo,
        dueBy: n.dueBy,
        createdAt: n.createdAt,
        automatic: n.createdBy === "Automatic check",
        appeals: n.appeals.map((a) => ({ id: a.id, message: a.message, status: a.status, response: a.response })),
        canAppeal: !n.appeals.some((a) => a.status === "open"),
      })),
      history: notices.filter((n) => n.closedAt).map((n) => ({ id: n.id, kind: n.kind, title: n.title, createdAt: n.createdAt })),
      verifiedSince: shop.verifiedAt,
      checklist: check.items.map((i) => ({ key: i.key, label: i.label, met: i.met, detail: i.detail })),
    };
  },
  "POST trust/:id/appeal": async ({ req, params, db, shop, user }) => {
    const b = await body<{ message?: unknown }>(req);
    await submitAppeal(db, shop.id, params.id!, str(b.message));
    await logged({ shop, user, db }, "Sent an appeal about a notice from us, in the app", { href: "/admin/trust" });
    return { ok: true, message: "Sent. A person reads every appeal and replies here, usually within two working days." };
  },
  "POST trust/verified": async ({ db, shop }) => {
    const since = await refreshVerified(db, shop.id);
    return { ok: true, message: since ? "Checked. Your store has the verified badge." : "Checked. Your store doesn't meet every rule yet." };
  },
  // Store pages (About us, Shipping, Returns...): plain text, visible or hidden, and the policy
  // pages we write from the store's own settings, added with a tap.
  "GET pages": async ({ db, shop }) => {
    const [pages, drafts, store] = await Promise.all([listPages(db, shop.id), draftPolicies(db, shop), storeAddress(shop)]);
    const root = store.replace(/\/$/, "");
    return {
      pages: pages.map((p) => ({ id: p.id, title: p.title, published: p.published, url: `${root}/pages/${p.handle}` })),
      policies: drafts.map((d) => ({ kind: d.kind, title: d.title, added: !!d.existingId })),
    };
  },
  "POST pages": async ({ req, db, shop, user }) => {
    const b = await body<{ title?: unknown; body?: unknown }>(req);
    // A new page starts hidden, so it isn't on the store half-written.
    const page = await createPage(db, shop.id, { title: str(b.title), body: str(b.body), published: false });
    await logged({ shop, user, db }, `Added the page “${page.title}” in the app`, { href: `/admin/pages/${page.id}` });
    return { ok: true, id: page.id, message: "Added. It's hidden until you show it on the store." };
  },
  "POST pages/policies": async ({ req, db, shop, user }) => {
    const b = await body<{ kinds?: unknown }>(req);
    const pages = await addPolicyPages(db, shop, Array.isArray(b.kinds) ? b.kinds.map(String) : []);
    if (pages.length) await logged({ shop, user, db }, `Added policy pages in the app: ${pages.map((p) => p.title).join(", ")}`, { href: "/admin/pages" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: pages.length ? `Added ${pages.map((p) => p.title).join(", ")}. Edit them any time.` : "Those pages are already there." };
  },
  "GET pages/:id": async ({ params, db, shop }) => {
    const [page, store] = await Promise.all([getPage(db, shop.id, params.id!), storeAddress(shop)]);
    return { page: { id: page.id, title: page.title, body: page.body, published: page.published, url: `${store.replace(/\/$/, "")}/pages/${page.handle}` } };
  },
  "PUT pages/:id": async ({ req, params, db, shop, user }) => {
    const b = await body<{ title?: unknown; body?: unknown; published?: unknown }>(req);
    const before = await getPage(db, shop.id, params.id!);
    // The address and search description are kept as they are.
    const page = await updatePage(db, shop.id, before.id, { title: str(b.title), body: str(b.body), handle: before.handle, seoDescription: before.seoDescription ?? "", published: b.published === true });
    if (page.published !== before.published) await logged({ shop, user, db }, `${page.published ? "Showed" : "Hid"} the page “${page.title}” in the app`, { href: `/admin/pages/${page.id}` });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: page.published ? "Saved. The page is on your store." : "Saved. The page is hidden from buyers." };
  },
  "DELETE pages/:id": async ({ params, db, shop, user }) => {
    const page = await getPage(db, shop.id, params.id!);
    await deletePage(db, shop.id, page.id);
    await logged({ shop, user, db }, `Deleted the page “${page.title}” in the app`, { href: "/admin/pages" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: `Deleted “${page.title}”.` };
  },
  "GET collections": async ({ db, shop }) => {
    const [collections, store] = await Promise.all([listCollections(db, shop.id), storeAddress(shop)]);
    return {
      collections: collections.map((c) => ({ id: c.id, title: c.title, auto: !!c.rules, productCount: c.productCount, url: `${store.replace(/\/$/, "")}/collections/${c.handle}` })),
      // Gift guides the store doesn't have yet, so one tap can make them.
      missingGuides: giftGuideTitles(shop.currency).filter((t) => !collections.some((c) => c.title === t)),
      guideCount: giftGuideTitles(shop.currency).length,
    };
  },
  "POST collections": async ({ req, db, shop, user }) => {
    const b = await body<{ title?: unknown }>(req);
    const c = await createCollection(db, shop.id, { title: str(b.title) });
    await logged({ shop, user, db }, `Made the collection ${c.title} in the app`, { href: `/admin/collections/${c.id}` });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, id: c.id, message: `Made ${c.title}. To fill it, open a product and switch it on under Collections.` };
  },
  "POST collections/gift-guides": async ({ db, shop, user }) => {
    const made = await createGiftGuides(db, shop);
    if (made.length) await logged({ shop, user, db }, `Made gift guides in the app: ${made.map((c) => c.title).join(", ")}`, { href: "/admin/collections" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return {
      ok: true,
      message: made.length === 0 ? "You already have every gift guide." : `Made ${made.length === 1 ? "1 gift guide" : `${made.length} gift guides`}. They fill themselves with what's in stock at that price, best sellers first.`,
    };
  },
  "DELETE collections/:id": async ({ params, db, shop, user }) => {
    const c = await getCollection(db, shop.id, params.id!);
    await deleteCollection(db, shop.id, c.id);
    await logged({ shop, user, db }, `Deleted the collection ${c.title} in the app`, { href: "/admin/collections" });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: `Deleted ${c.title}. Its products are still on sale.` };
  },
  "GET holiday-checklist": async ({ db, shop, role }) => {
    const checks = await holidayChecklist(db, shop);
    // Lines the app can set up itself open that screen; the rest open the website.
    const inApp: Record<string, { path: string; area: Area; also?: Area }> = {
      "order-by": { path: "/holiday-date", area: "shipping" },
      late: { path: "/late-emails", area: "shipping" },
      sale: { path: "/sales", area: "marketing" },
      "gift-guides": { path: "/collections", area: "collections" },
      "gift-wrap": { path: "/gift-wrap", area: "shipping" },
      delivery: { path: "/delivery-dates", area: "shipping" },
      look: { path: "/store-look", area: "theme" },
      returns: { path: "/holiday-returns", area: "returns" },
      "gift-cards": { path: "/gift-cards", area: "gift_cards" },
      popup: { path: "/signup", area: "marketing" },
      reminders: { path: "/checkouts", area: "marketing", also: "orders" },
    };
    return {
      season: holidaySeason(),
      checks: checks.map((c) => {
        const a = inApp[c.key];
        // The backups line points at the first best seller without one.
        if (c.key === "backups" && can(role, "products")) {
          const id = /^\/admin\/products\/([^/#]+)/.exec(c.href)?.[1];
          return { key: c.key, title: c.title, done: c.done, detail: c.detail, app: id ? `/products/${id}` : "/products", web: c.href };
        }
        return { key: c.key, title: c.title, done: c.done, detail: c.detail, app: a && can(role, a.area) && (!a.also || can(role, a.also)) ? a.path : null, web: c.href };
      }),
    };
  },
  "GET questions": async ({ url, db, shop }) => {
    const show = url.searchParams.get("show") === "all" ? "all" : "waiting";
    const rows = await listQuestions(db, shop.id);
    return {
      waiting: rows.filter((q) => q.status === "waiting").length,
      questions: rows
        .filter((q) => show === "all" || q.status === "waiting")
        .slice(0, 50)
        .map((q) => ({
          id: q.id,
          productTitle: q.product.title,
          name: q.name,
          email: q.email,
          body: q.body,
          status: q.status,
          answer: q.answer,
          // A suggested answer written on the website, to start from.
          draft: q.draft,
          createdAt: q.createdAt,
          answeredAt: q.answeredAt,
        })),
    };
  },
  "POST questions/:id": async ({ req, params, db, shop, user }) => {
    const b = await body<{ action?: unknown; answer?: unknown; publish?: unknown }>(req);
    if (b.action === "answer") {
      const publish = b.publish !== false;
      const { question, emailed } = await answerQuestion(await stock(), shop, params.id!, { answer: str(b.answer), publish });
      await logged({ shop, user, db }, `Answered ${question.name}'s question about a product in the app`, { href: "/admin/questions" });
      revalidatePath(`/s/${shop.handle}`, "layout");
      return {
        ok: true,
        message: [emailed ? `Answer sent. ${question.name} gets it by email.` : "Answer saved.", publish ? "It shows on the product page." : "Only they see it."].join(" "),
      };
    }
    if (b.action === "publish" || b.action === "hide") {
      await setQuestionPublished(db, shop.id, params.id!, b.action === "publish");
      revalidatePath(`/s/${shop.handle}`, "layout");
      return { ok: true, message: b.action === "publish" ? "It shows on the product page." : "Taken off the product page. They still have the answer by email." };
    }
    throw new HttpError(400, "Pick answer, publish or hide.");
  },
  "GET disputes": async ({ db, shop }) => {
    const [stats, rows] = await Promise.all([disputeStats(db, shop.id), listDisputes(db, shop.id)]);
    return {
      open: stats.open,
      atStakeMinor: stats.atStakeMinor,
      won: stats.won,
      lost: stats.lost,
      // Banks start to worry at 0.75% of orders over 90 days.
      rate: stats.rate,
      tooHigh: stats.orders > 0 && stats.rate >= 0.0075,
      disputes: rows.slice(0, 50).map((d) => ({
        id: d.id,
        orderId: d.orderId,
        orderNumber: d.orderNumber,
        email: d.email,
        status: d.status,
        inquiry: d.inquiry,
        reason: disputeReason(d.reason).label,
        amountMinor: d.amountMinor,
        currency: d.currency,
        evidenceDueBy: d.evidenceDueBy,
        createdAt: d.createdAt,
      })),
    };
  },
  "POST disputes/:id": async ({ req, params, db, shop, user }) => {
    const b = await body<{ action?: unknown; note?: unknown }>(req);
    const ctx = { db, payments: payments() };
    if (b.action === "submit") {
      const d = await submitDispute(ctx, shop, params.id!, { note: str(b.note) });
      await logged({ shop, user, db }, "Sent the evidence for the dispute on order {order} in the app", { orderId: d.orderId ?? undefined, href: "/admin/disputes" });
      return { ok: true, message: "Evidence sent. The bank will decide, and the result shows here." };
    }
    if (b.action === "accept") {
      const d = await acceptDispute(ctx, shop, params.id!);
      await logged({ shop, user, db }, "Accepted the dispute on order {order} in the app", { orderId: d.orderId ?? undefined, href: "/admin/disputes" });
      return { ok: true, message: "Accepted. The buyer keeps the money back." };
    }
    throw new HttpError(400, "Pick send or accept.");
  },
  "POST orders/:id/block": async ({ req, params, db, shop, user }) => {
    const b = await body<{ note?: unknown }>(req);
    const order = await blockOrderBuyer(db, shop.id, params.id!, str(b.note));
    await logged({ shop, user, db }, `Blocked the buyer of order #${order.number} from checking out in the app`, { orderId: order.id, href: "/admin/blocked" });
    return { ok: true, message: `${order.shippingAddress.name} can't check out at your store any more, with this email or address. Unblock them under Customers, Blocked buyers.` };
  },
  "POST orders/:id/handover": async ({ req, params, db, shop, user }) => {
    const b = await body<{ step?: unknown }>(req);
    const ctx = await fulfillment();
    const steps = {
      ready: [() => markReadyForPickup(ctx, shop.id, params.id!), "Told the buyer order {order} is ready for pickup", "The buyer was emailed that it's ready to pick up."],
      picked_up: [() => markPickedUp(ctx, shop.id, params.id!), "Marked order {order} picked up", "Marked picked up. The buyer gets an email."],
      delivered: [() => markDeliveredByStore(ctx, shop.id, params.id!), "Marked order {order} delivered", "Marked delivered. The buyer gets an email."],
    } as const;
    const step = steps[String(b.step) as keyof typeof steps];
    if (!step) throw new HttpError(400, "Pick ready, picked up or delivered.");
    await step[0]();
    await logged({ shop, user, db }, `${step[1]} in the app`, { orderId: params.id! });
    return { ok: true, message: step[2] };
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

  "GET products": async ({ db, shop }) => {
    const [products, changes] = await Promise.all([listProducts(db, shop.id), listCostChanges(db, shop)]);
    return {
      products: products.map((p) => ({ ...productView(p), stockLevel: stockLevel(p, shop.restockAlertAt) })),
      priceRises: changes.filter((c) => c.status === "open").length,
    };
  },
  "GET products/:id": async ({ params, db, shop }) => {
    const p = await getProduct(db, shop.id, params.id!);
    const [sold, storeTags, collections, inIds] = await Promise.all([
      p.preorder ? preordersSold(db, p.id) : 0,
      productTags(db, shop.id),
      listCollections(db, shop.id),
      collectionsOfProduct(db, shop.id, p.id),
    ]);
    const isIn = new Set(inIds);
    return {
      ...productView(p),
      preordersSold: sold,
      // The store's other tags, most used first, to tap instead of typing.
      storeTags: storeTags.map((t) => t.tag).slice(0, 30),
      maxTags: MAX_PRODUCT_TAGS,
      // Hand-picked collections can be switched here; automatic ones fill by their rules.
      collections: collections.map((c) => ({ id: c.id, title: c.title, auto: !!c.rules, in: isIn.has(c.id) })),
      // A second supplier's listing of the same product, for when the main one runs out.
      backup: {
        possible: !!p.supplierId && !!p.sourceUrl && !p.giftCard,
        link: p.backup
          ? {
              sourceUrl: p.backup.sourceUrl,
              gone: !!p.backup.gone,
              checkedAt: p.backup.checkedAt,
              options: p.variants.map((v) => ({ title: v.title, costMinor: p.backup!.variants[v.id]?.costMinor ?? null, stock: p.backup!.variants[v.id]?.stock ?? null, covered: !!p.backup!.variants[v.id] })),
            }
          : null,
      },
    };
  },
  "PUT products/:id/backup": async ({ req, params, db, shop, user }) => {
    const b = await body<{ url?: unknown }>(req);
    const p = await getProduct(db, shop.id, params.id!);
    const { unmatched } = await setBackupSupplier(db, suppliers(), shop.id, p.id, str(b.url));
    await resyncStock(shop.id, p.id);
    await logged({ shop, user, db }, `Added a backup supplier for ${p.title} in the app`, { href: `/admin/products/${p.id}#backup-heading` });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return {
      ok: true,
      message: unmatched.length
        ? `Backup saved. ${unmatched.join(", ")} ${unmatched.length === 1 ? "has" : "have"} no match there, so ${unmatched.length === 1 ? "it isn't" : "they aren't"} covered.`
        : "Backup saved. Orders go there when the main supplier is out of stock.",
    };
  },
  "DELETE products/:id/backup": async ({ params, db, shop, user }) => {
    const p = await getProduct(db, shop.id, params.id!);
    await removeBackupSupplier(db, shop.id, p.id);
    await resyncStock(shop.id, p.id);
    await logged({ shop, user, db }, `Removed the backup supplier for ${p.title} in the app`, { href: `/admin/products/${p.id}#backup-heading` });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message: "Backup removed." };
  },
  "PUT products/:id/collections/:collectionId": async ({ req, params, db, shop, user }) => {
    const b = await body<{ in?: unknown }>(req);
    const p = await getProduct(db, shop.id, params.id!);
    const nowIn = await setProductInCollection(db, shop.id, params.collectionId!, p.id, b.in === true);
    const title = (await listCollections(db, shop.id)).find((c) => c.id === params.collectionId)?.title ?? "a collection";
    await logged({ shop, user, db }, nowIn ? `Added ${p.title} to ${title} in the app` : `Took ${p.title} out of ${title} in the app`, { href: `/admin/products/${p.id}` });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, in: nowIn, message: nowIn ? `Added to ${title}.` : `Taken out of ${title}.` };
  },
  "PUT products/:id/preorder": async ({ req, params, db, shop, user }) => {
    const b = await body<{ on?: unknown; shipsBy?: unknown; limit?: unknown }>(req);
    const limit = str(b.limit).trim();
    const p = await getProduct(db, shop.id, params.id!);
    const saved = await setPreorder(db, shop.id, p.id, b.on === true ? { shipsBy: str(b.shipsBy).trim(), limit: limit ? Number(limit) : null } : null);
    await logged({ shop, user, db }, saved ? `Turned on pre-orders for ${p.title} in the app` : `Turned off pre-orders for ${p.title} in the app`, { href: `/admin/products/${p.id}` });
    return { ok: true, message: saved ? "Saved. Sold-out options can now be pre-ordered." : "Saved. Sold-out options can't be ordered." };
  },
  "PUT products/:id/limits": async ({ req, params, db, shop, user }) => {
    const b = await body<{ min?: unknown; max?: unknown; perCustomer?: unknown }>(req);
    const num = (v: unknown) => (str(v).trim() ? Number(str(v).trim()) : null);
    const p = await getProduct(db, shop.id, params.id!);
    const saved = await setPurchaseLimit(db, shop.id, p.id, { min: num(b.min), max: num(b.max), perCustomer: num(b.perCustomer) });
    await logged({ shop, user, db }, `Changed the purchase limits for ${p.title} in the app`, { href: `/admin/products/${p.id}` });
    return { ok: true, message: saved ? "Saved. The cart and checkout now follow these limits." : "Saved. Buyers can order as many as they like." };
  },
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
      // Disputes waiting for an answer, for the button to the Disputes screen.
      disputesOpen: await countOpenDisputes(db, shop.id),
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

  "GET codes": async ({ db, shop }) => ({
    codes: (await listDiscounts(db, shop.id)).map((d) => ({
      id: d.id,
      code: d.code,
      summary: describeDiscount(d, shop.currency),
      automatic: d.automatic,
      firstOrderOnly: d.firstOrderOnly,
      active: d.active,
      used: d.used,
      salesMinor: d.salesMinor,
      usageLimit: d.usageLimit,
      endsAt: d.endsAt,
    })),
  }),
  "POST codes": async ({ req, db, shop, user }) => {
    const b = await body<{ code?: unknown; kind?: unknown; value?: unknown; firstOrderOnly?: unknown; usageLimit?: unknown }>(req);
    // The everyday kinds from the phone; buy X get Y, products and dates are on the website.
    const kind = b.kind === "amount" || b.kind === "free_shipping" ? b.kind : "percent";
    const created = await createDiscount(db, shop.id, {
      code: str(b.code),
      kind,
      value: typeof b.value === "number" ? Math.round(b.value) : 0,
      firstOrderOnly: b.firstOrderOnly === true,
      usageLimit: typeof b.usageLimit === "number" ? Math.round(b.usageLimit) : null,
    });
    await logged({ shop, user, db }, `Created the discount code ${created.code} in the app`, { href: "/admin/marketing" });
    return { ok: true, message: `${created.code} is ready: ${describeDiscount(created, shop.currency)}.` };
  },
  "POST codes/:id": async ({ req, params, db, shop, user }) => {
    const b = await body<{ active?: unknown }>(req);
    const row = await setDiscountActive(db, shop.id, params.id!, b.active === true);
    await logged({ shop, user, db }, `${row.active ? "Turned on" : "Turned off"} the discount code ${row.code} in the app`, { href: "/admin/marketing" });
    return { ok: true, message: row.active ? `${row.code} works again.` : `${row.code} is off. Buyers who try it are told it doesn't work.` };
  },
  "GET returns": async ({ url, db, shop }) => {
    const show = url.searchParams.get("show") === "all" ? "all" : "open";
    const [open, rows] = await Promise.all([countReturns(db, shop.id, "open"), listReturns(db, shop.id, show, { size: 50 })]);
    const names = new Map(
      rows.length
        ? (await db.query.orders.findMany({ where: (o, { inArray }) => inArray(o.id, rows.map((r) => r.orderId)), columns: { id: true, shippingAddress: true } })).map((o) => [o.id, o.shippingAddress.name])
        : [],
    );
    return {
      open,
      returns: rows.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        name: r.giftReturn?.name ?? names.get(r.orderId) ?? r.email,
        // A gift's recipient sent it back: only store credit, so the buyer never hears of it.
        gift: !!r.giftReturn,
        status: r.status,
        reason: RETURN_REASON_LABELS[r.reason],
        note: r.note,
        items: r.items.map((i) => ({ title: i.title, quantity: i.quantity, exchangeTitle: i.exchangeTitle ?? null })),
        suggestedMinor: r.suggestedMinor,
        resolvedMinor: r.resolvedMinor,
        merchantMessage: r.merchantMessage,
        currency: r.currency,
        createdAt: r.createdAt,
      })),
    };
  },
  "POST returns/:id": async ({ req, params, db, shop, user }) => {
    const b = await body<{ action?: unknown; amountMinor?: unknown; message?: unknown }>(req);
    const message = str(b.message);
    const amountMinor = typeof b.amountMinor === "number" ? Math.round(b.amountMinor) : 0;
    const action = String(b.action ?? "");
    let decision: ReturnDecision;
    if (action === "approve" || action === "decline" || action === "replace" || action === "exchange") decision = { action, message };
    else if (action === "refund" || action === "credit") decision = { action, amountMinor, message };
    else throw new HttpError(400, "Pick what to do with this return.");
    const r = await decideReturn({ ...(await refunds()), storeAddress }, shop, params.id!, decision);
    const money = formatMoney(amountMinor, shop.currency);
    const said = {
      approve: ["Approved the return on order {order}", "Approved. The buyer gets an email with what to do next."],
      decline: ["Declined the return on order {order}", "Declined. The buyer gets an email with your reason."],
      refund: [`Refunded ${money} for the return on order {order}`, `Refunded ${money}. The buyer gets an email.`],
      credit: [`Gave ${money} store credit for the return on order {order}`, `${money} in store credit sent by email.`],
      replace: ["Sent a replacement for the return on order {order}", "A free replacement order is made. The buyer gets an email."],
      exchange: ["Sent an exchange for the return on order {order}", "The exchange goes out as a free order. The buyer gets an email with what to send back."],
    }[decision.action];
    await logged({ shop, user, db }, `${said[0]} in the app`, { orderId: r.orderId });
    if (decision.action === "refund") notifyLater(shop.id);
    return { ok: true, message: said[1] };
  },
  "GET sales": async ({ db, shop }) => {
    const all = await listSales(db, shop.id);
    // Running and coming ones, then the last few that ended; the website keeps the whole list.
    const ended = all.filter((x) => x.status === "ended").slice(0, 5);
    return {
      sales: [...all.filter((x) => x.status !== "ended"), ...ended].map((x) => ({
        id: x.id,
        title: x.title,
        percentOff: x.percentOff,
        status: x.status,
        covers: x.covers,
        startsAt: x.startsAt,
        endsAt: x.endsAt,
        countdown: x.countdown,
      })),
    };
  },
  "POST sales": async ({ req, db, shop, user }) => {
    const b = await body<{ title?: unknown; percentOff?: unknown; days?: unknown; countdown?: unknown }>(req);
    // From the phone: everything, starting now, for a few days or until it's ended. Collections,
    // chosen products and a later start are on the website.
    const days = typeof b.days === "number" && (SALE_EXTEND_DAYS as readonly number[]).includes(b.days) ? b.days : null;
    const now = new Date();
    const sale = await createSale(db, shop.id, {
      title: str(b.title),
      percentOff: typeof b.percentOff === "number" ? b.percentOff : Number.NaN,
      scope: "all",
      startsAt: now,
      endsAt: days ? new Date(now.getTime() + days * 86_400_000) : null,
      countdown: b.countdown === true && !!days,
    });
    await sendPriceDrops(await stock(), { shopId: shop.id });
    revalidatePath(`/s/${shop.handle}`, "layout");
    await logged({ shop, user, db }, `Started the sale ${sale.title} (${sale.percentOff}% off everything) in the app`, { href: "/admin/sales" });
    return { ok: true, message: `${sale.title} is on: ${sale.percentOff}% off everything${sale.endsAt ? `, for ${days} ${days === 1 ? "day" : "days"}` : " until you end it"}.` };
  },
  "POST sales/:id": async ({ req, params, db, shop, user }) => {
    const b = await body<{ action?: unknown; days?: unknown }>(req);
    const sale = (await listSales(db, shop.id)).find((x) => x.id === params.id);
    if (!sale) throw new NotFoundError("Sale");
    let message: string;
    if (b.action === "extend") {
      const days = typeof b.days === "number" ? b.days : 0;
      await extendSale(db, shop.id, sale.id, days);
      message = `${sale.title} runs ${days} more ${days === 1 ? "day" : "days"}.`;
      await logged({ shop, user, db }, `Kept the sale ${sale.title} on ${days} more ${days === 1 ? "day" : "days"} in the app`, { href: "/admin/sales" });
    } else if (b.action === "end") {
      await endSale(db, shop.id, sale.id);
      message = sale.status === "scheduled" ? `${sale.title} won't start.` : `${sale.title} has ended. Prices are back to normal.`;
      await logged({ shop, user, db }, `Ended the sale ${sale.title} in the app`, { href: "/admin/sales" });
    } else throw new HttpError(400, "Pick end or extend.");
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, message };
  },
  "GET gift-cards": async ({ url, db, shop }) => {
    // The same search as the web list: the full code a buyer reads out, its last 4, an email or an order number.
    const q = url.searchParams.get("q")?.trim() ?? "";
    const [{ cards, outstandingMinor }, product] = await Promise.all([listGiftCards(db, shop.id, { query: q, size: 30 }), giftCardProduct(db, shop.id)]);
    const variants = product ? await db.query.variants.findMany({ where: (v, { eq }) => eq(v.productId, product.id), orderBy: (v, { asc }) => asc(v.position), columns: { priceMinor: true } }) : [];
    const now = new Date();
    return {
      outstandingMinor,
      // The gift card the store sells, if it sells one.
      selling: product ? { productId: product.id, active: product.status === "active", amountsMinor: variants.map((v) => v.priceMinor) } : null,
      cards: cards.map((c) => ({
        id: c.id,
        last4: c.last4,
        email: c.email,
        balanceMinor: c.balanceMinor,
        initialMinor: c.initialMinor,
        status: c.disabledAt ? "off" : c.expiresAt && c.expiresAt <= now ? "expired" : c.balanceMinor === 0 ? "used" : "active",
        orderNumber: c.orderNumber,
        sent: !!c.sentAt,
        createdAt: c.createdAt,
        expiresAt: c.expiresAt,
      })),
    };
  },
  "POST gift-cards/sell": async ({ req, db, shop, user }) => {
    const b = await body<{ amounts?: unknown }>(req);
    const amounts = str(b.amounts)
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((raw) => {
        try {
          return parseMoney(raw.replace(/^[$€£¥₹]/, ""));
        } catch {
          throw new UserError("Enter amounts like 25 or 49.99.");
        }
      });
    const product = await createGiftCardProduct(db, shop, amounts);
    await logged({ shop, user, db }, "Started selling gift cards in the app", { href: `/admin/products/${product.id}` });
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { ok: true, productId: product.id, message: "Gift cards are on sale. Buyers get the code by email right after paying." };
  },
  "POST gift-cards": async ({ req, db, shop, user }) => {
    const b = await body<{ email?: unknown; amountMinor?: unknown }>(req);
    const email = str(b.email);
    const amountMinor = typeof b.amountMinor === "number" ? Math.round(b.amountMinor) : 0;
    const { sent } = await issueGiftCard(await campaigns(), shop, { email, amountMinor, userId: user.id });
    await logged({ shop, user, db }, `Gave a ${formatMoney(amountMinor, shop.currency)} gift card to ${email} in the app`, { href: "/admin/gift-cards" });
    if (!sent) throw new HttpError(502, "The gift card was made but the email didn't go out. Send a new code on it to try again.");
    return { ok: true, message: `A ${formatMoney(amountMinor, shop.currency)} gift card is on its way to ${email}.` };
  },
  "POST gift-cards/:id": async ({ req, params, db, shop, user }) => {
    const b = await body<{ action?: unknown }>(req);
    const card = await db.query.giftCards.findFirst({ where: (g, { and, eq }) => and(eq(g.id, params.id!), eq(g.shopId, shop.id)) });
    if (!card) throw new NotFoundError("Gift card");
    if (b.action === "resend") {
      await resendGiftCard(await campaigns(), shop, card.id);
      await logged({ shop, user, db }, `Sent a new code for the gift card ending ${card.last4} in the app`, { href: "/admin/gift-cards" });
      return { ok: true, message: `A new code went to ${card.email}. The old one no longer works.` };
    }
    if (b.action !== "off" && b.action !== "on") throw new HttpError(400, "Pick off, on or resend.");
    await setGiftCardDisabled(db, shop.id, card.id, b.action === "off");
    await logged({ shop, user, db }, `${b.action === "off" ? "Turned off" : "Turned back on"} the gift card ending ${card.last4} in the app`, { href: "/admin/gift-cards" });
    return { ok: true, message: b.action === "off" ? `The card ending ${card.last4} is off. It can't be spent until you turn it back on.` : `The card ending ${card.last4} works again.` };
  },
  "GET checkouts": async ({ db, shop }) => {
    // Checkouts left unpaid in the last 30 days, as on the web's Abandoned checkouts page.
    const { checkouts, totals } = await abandonedCheckouts(db, shop.id, { size: 50 });
    return {
      days: ABANDONED_DAYS,
      remindersOn: shop.abandonedCartEmails,
      // The second reminder, a day later, with a one-time code for this percent off.
      offerPercent: shop.abandonedCartOffer?.percentOff ?? null,
      totals,
      checkouts: checkouts.map((c) => ({
        id: c.id,
        number: c.number,
        name: c.name,
        email: c.email,
        totalMinor: c.totalMinor,
        currency: c.currency,
        items: c.items,
        createdAt: c.createdAt,
        reminder: c.offered ? "code" : c.reminded ? "sent" : "none",
        // The order they paid with in the end: this checkout, or a new one.
        paidAs: c.recoveredBy,
      })),
    };
  },
  "PUT checkouts/reminders": async ({ req, db, shop, user }) => {
    const b = await body<{ on?: unknown; offer?: unknown; percentOff?: unknown }>(req);
    const on = b.on === true;
    const percent = on && b.offer === true ? Number.parseInt(str(b.percentOff).trim() || "0", 10) : null;
    await setAbandonedCartOffer(db, shop.id, percent);
    await setGrowthSettings(db, shop.id, { abandonedCartEmails: on });
    await logged(
      { shop, user, db },
      !on ? "Turned off checkout reminders in the app" : percent ? `Turned on checkout reminders, the second with ${percent}% off, in the app` : "Turned on checkout reminders in the app",
      { href: "/admin/marketing#reminders-heading" },
    );
    return {
      ok: true,
      message: !on
        ? "Saved. Buyers who leave at checkout aren't reminded."
        : percent
          ? `Saved. Buyers who leave get a reminder after an hour, and a day later a one-time code for ${percent}% off.`
          : "Saved. Buyers who leave get a reminder after an hour.",
    };
  },
  "GET customers": async ({ url, db, shop }) => {
    const q = (url.searchParams.get("q") ?? "").slice(0, 100);
    // The ones who bought most recently first; a search looks at names and emails.
    const rows = await listCustomers(db, shop.id, { query: q || undefined, limit: 50 });
    return {
      customers: rows.map((c) => ({ id: c.id, name: c.name, email: c.email, orders: c.orders, spentMinor: c.spentMinor, lastOrderAt: c.lastOrderAt, tags: c.tags })),
    };
  },
  "GET customers/:id": async ({ params, db, shop }) => customerView(await getCustomerProfile(db, shop.id, params.id!)),
  "PATCH customers/:id": async ({ req, params, db, shop }) => {
    const b = await body<{ note?: unknown; tags?: unknown }>(req);
    await updateCustomerNotes(db, shop.id, params.id!, {
      ...(typeof b.note === "string" ? { note: b.note } : {}),
      ...(typeof b.tags === "string" ? { tags: b.tags } : {}),
    });
    return customerView(await getCustomerProfile(db, shop.id, params.id!));
  },
  "POST customers/:id/credit": async ({ req, params, db, shop, user }) => {
    const b = await body<{ amountMinor?: unknown; note?: unknown }>(req);
    const profile = await getCustomerProfile(db, shop.id, params.id!);
    const amountMinor = typeof b.amountMinor === "number" ? Math.round(b.amountMinor) : 0;
    // Store credit is a gift card in their name: it works at checkout and adds to what they have.
    const { sent } = await issueGiftCard(await campaigns(), shop, { email: profile.customer.email, amountMinor, note: str(b.note) || "Store credit given from the app", userId: user.id });
    await logged({ shop, user, db }, `Gave ${formatMoney(amountMinor, shop.currency)} store credit to ${profile.customer.email} in the app`, { href: "/admin/gift-cards" });
    if (!sent) throw new HttpError(502, "The credit was made but its email didn't go out. Send a new code from Gift cards on the website.");
    return { ok: true, message: `${formatMoney(amountMinor, shop.currency)} in store credit sent to ${profile.customer.email}.`, customer: customerView(await getCustomerProfile(db, shop.id, params.id!)) };
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
  if (key === "POST customers/:id/credit") return "gift_cards";
  if (key === "POST orders/:id/transfer-paid" || key === "PUT bank-transfers") return "money";
  if (key === "PUT products/:id/collections/:collectionId") return "collections";
  if (key === "PUT checkouts/reminders") return "marketing";
  const path = key.split(" ")[1]!;
  if (path.startsWith("orders")) return "orders";
  if (path.startsWith("products") || path.startsWith("imports")) return "products";
  if (path.startsWith("money")) return "money";
  if (path.startsWith("assistant") || path.startsWith("actions")) return "assistant";
  if (path.startsWith("inbox")) return "inbox";
  if (path.startsWith("saved-replies")) return "inbox";
  if (path.startsWith("reviews")) return "reviews";
  if (path.startsWith("customers")) return "customers";
  if (path.startsWith("codes")) return "marketing";
  if (path.startsWith("code-batches")) return "marketing";
  if (path.startsWith("disputes")) return "money";
  if (path.startsWith("questions")) return "reviews";
  if (path.startsWith("payment-links")) return "orders";
  if (path.startsWith("analytics")) return "analytics";
  if (path.startsWith("activity") || path.startsWith("team")) return "team";
  if (path.startsWith("subscriptions")) return "orders";
  if (path.startsWith("blocked")) return "customers";
  if (path.startsWith("tag-rules")) return "customers";
  if (path.startsWith("collections")) return "collections";
  if (path.startsWith("restock") || path.startsWith("stock-count")) return "products";
  if (path.startsWith("price-changes")) return "products";
  if (path.startsWith("search-fixes")) return "products";
  if (path.startsWith("blog")) return "pages";
  if (path === "pages" || path.startsWith("pages/")) return "pages";
  if (path.startsWith("trust")) return "trust";
  if (path.startsWith("suppliers")) return "suppliers";
  if (path.startsWith("cart-links")) return "marketing";
  if (path.startsWith("wholesale")) return "wholesale";
  if (path.startsWith("partners")) return "marketing";
  if (path.startsWith("campaigns")) return "marketing";
  if (path.startsWith("survey")) return "marketing";
  if (path.startsWith("rewards")) return "marketing";
  if (path.startsWith("bundles")) return "marketing";
  if (path.startsWith("bank-transfers")) return "orders";
  if (path.startsWith("checkouts")) return "orders";
  if (path.startsWith("store-status")) return "theme";
  if (path.startsWith("store-look")) return "theme";
  if (path.startsWith("ship-pause")) return "shipping";
  if (path.startsWith("late-emails")) return "shipping";
  if (path.startsWith("holiday-date")) return "shipping";
  if (path.startsWith("gift-wrap")) return "shipping";
  if (path.startsWith("delivery-dates")) return "shipping";
  if (path.startsWith("signup")) return "marketing";
  if (path.startsWith("gift-cards")) return "gift_cards";
  if (path.startsWith("sales")) return "marketing";
  if (path.startsWith("returns")) return "returns";
  if (path.startsWith("holiday-returns")) return "returns";
  if (path === "today") return "home";
  if (path === "holiday-checklist") return "home";
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
