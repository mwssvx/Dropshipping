"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { cartLineKey, cleanPersonalization, sameCartLine, acceptPostPurchaseOffer, amountToCharge, changeSubscription, startSubscription, type SubscriptionChange, askQuestion, cancelOrderByBuyer, claimReferral, editOrder, getOrder, NotFoundError, pickAddonVariant, pickBundleVariants, getOrderByPaymentIntent, normalizeGiftCardCode, requestReturn, recordEvent, visitPost, visitSource, handleBuyerMessage, quoteCart, requestNewsletterSignup, requestOrderLink, requestStockAlert, MAX_SAVED, saveItem, setPriceAlerts, shareSaved, stopSharingSaved, shopCurrencies, unsaveItem, startCheckout, submitReview, FakePaymentProvider, UserError, enterStorePassword, storeAccessCookie, sendContactMessage, answerBuyer, answerSurvey, chooseBankTransfer, joinLaunchList, toggleCompareId, lookVariants, stayPathAfterAdd, toggleHelpful, reportReview, rewardReview, VOTER_PATTERN, reviewsQuery, reviewSort, starsFilter } from "@sf/core";
import { readCart, readDiscountCode, readGiftCardCode, writeCart, writeDiscountCode, writeGiftCardCode } from "@/lib/cart";
import { agents, campaigns, db, fulfillment, mailer, payments, platformUrl, refunds, storeAddress, subscriptions, tax } from "@/lib/server";
import { afterOrderPaid, processPaymentWebhook } from "@/lib/webhooks";
import { loadShop, storeBase } from "./data";
import { buyerFx, currencyCookie } from "@/lib/currency";
import { campaignCookie } from "@/lib/campaigns";
import { currentBuyer } from "@/lib/buyer";
import { readOrderEdit } from "@/lib/order-edit";
import type { OrderEditState } from "@/components/OrderEditForm";
import { readGuestSaved, writeGuestSaved } from "@/lib/saved";
import { readCompare, writeCompare } from "@/lib/compare";

/** The visit id the store's tracker set, for the funnel. */
async function track(shopId: string, kind: "add_to_cart" | "checkout_start", productId?: string | null) {
  const sessionId = (await cookies()).get("sf_vid")?.value;
  if (!sessionId) return;
  after(async () => {
    await recordEvent(await db(), shopId, { sessionId, kind, productId }).catch(() => {});
  });
}

/** After adding to the cart: the cart, or back to the page the shopper was on when the store keeps them there. */
async function afterAdd(shop: { stayAfterAdd: boolean }, base: string): Promise<never> {
  const back = shop.stayAfterAdd ? stayPathAfterAdd((await headers()).get("referer"), base) : null;
  redirect(back ?? `${base}/cart`);
}

export async function addToCartAction(handle: string, form: FormData) {
  const shop = await loadShop(handle);
  const variantId = String(form.get("variantId") ?? "");
  const quantity = Math.min(99, Math.max(1, Number(form.get("quantity") ?? 1) || 1));
  const variant = await (await db()).query.variants.findFirst({ where: (v, { eq }) => eq(v.id, variantId), columns: { productId: true } }).catch(() => undefined);
  // What the buyer typed into a personalised product's fields ("custom.<field id>").
  const typed = Object.fromEntries([...form.entries()].filter(([k]) => k.startsWith("custom.")).map(([k, v]) => [k.slice(7), String(v)]));
  const fields = variant && Object.keys(typed).length
    ? ((await (await db()).query.products.findFirst({ where: (p, { and, eq }) => and(eq(p.id, variant.productId), eq(p.shopId, shop.id)), columns: { personalization: true } }))?.personalization ?? [])
    : [];
  const custom = cleanPersonalization(fields, typed);
  const added = custom ? { variantId, quantity, custom } : { variantId, quantity };
  const cart = await readCart(shop.id);
  const line = cart.find((l) => sameCartLine(l, added));
  if (line) line.quantity = Math.min(99, line.quantity + quantity);
  else cart.push(added);
  await writeCart(shop.id, cart);
  await track(shop.id, "add_to_cart", variant?.productId);
  await afterAdd(shop, await storeBase(handle));
}

/** Adds one of each piece in a home page "Shop the look" section that has nothing to choose. */
export async function addLookAction(handle: string, form: FormData) {
  const shop = await loadShop(handle);
  const variantIds = await lookVariants(await db(), shop.id, form.getAll("variantId").map(String));
  const cart = await readCart(shop.id);
  for (const variantId of variantIds) {
    const line = cart.find((l) => l.variantId === variantId && !l.custom);
    if (line) line.quantity = Math.min(99, line.quantity + 1);
    else cart.push({ variantId, quantity: 1 });
  }
  if (variantIds.length) {
    await writeCart(shop.id, cart);
    await track(shop.id, "add_to_cart");
  }
  await afterAdd(shop, await storeBase(handle));
}

/** Adds one of each product in a bundle, with the options the buyer picked. */
export async function addBundleAction(handle: string, bundleId: string, form: FormData) {
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const picked: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (key.startsWith("v_") && typeof value === "string") picked[key.slice(2)] = value;
  const variantIds = await pickBundleVariants(await db(), shop.id, bundleId, picked).catch((e) => {
    if (e instanceof UserError) redirect(`${base}/cart`);
    throw e;
  });
  const cart = await readCart(shop.id);
  for (const variantId of variantIds) {
    const line = cart.find((l) => l.variantId === variantId);
    if (line) line.quantity = Math.min(99, line.quantity + 1);
    else cart.push({ variantId, quantity: 1 });
  }
  await writeCart(shop.id, cart);
  await track(shop.id, "add_to_cart");
  await afterAdd(shop, base);
}

/**
 * Adds the checkout add-on the buyer picked. The checkout page re-renders in place, so what they
 * already typed stays.
 */
export async function addAddonAction(handle: string, addonId: string, form: FormData) {
  const shop = await loadShop(handle);
  try {
    const variantId = await pickAddonVariant(await db(), shop.id, addonId, String(form.get("variantId") ?? ""));
    const cart = await readCart(shop.id);
    if (!cart.some((l) => l.variantId === variantId)) cart.push({ variantId, quantity: 1 });
    await writeCart(shop.id, cart);
  } catch (e) {
    if (!(e instanceof UserError || e instanceof NotFoundError)) throw e;
  }
  revalidatePath(`/s/${shop.handle}`, "layout");
}

export async function updateCartAction(handle: string, form: FormData) {
  const shop = await loadShop(handle);
  // Lines are told apart by option and personalisation.
  const key = String(form.get("line") ?? "");
  const quantity = Math.min(99, Math.max(0, Number(form.get("quantity") ?? 0) || 0));
  const cart = (await readCart(shop.id)).map((l) => (cartLineKey(l) === key ? { ...l, quantity } : l));
  await writeCart(shop.id, cart);
  redirect(`${await storeBase(handle)}/cart`);
}

/** Moves a cart line to the buyer's saved items, so it's out of this order but easy to find again. */
export async function saveForLaterAction(handle: string, key: string, productId: string) {
  const shop = await loadShop(handle);
  const buyer = await currentBuyer(shop.id);
  let full = false;
  if (buyer) {
    try {
      await saveItem(await db(), shop.id, buyer.id, productId);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      full = true;
    }
  } else {
    const ids = (await readGuestSaved(shop.id)).filter((id) => id !== productId);
    if (ids.length >= MAX_SAVED) full = true;
    else await writeGuestSaved(shop.id, [...ids, productId]);
  }
  // A full list keeps the item in the cart rather than losing it.
  if (!full) await writeCart(shop.id, (await readCart(shop.id)).filter((l) => cartLineKey(l) !== key));
  revalidatePath(`/s/${handle}`, "layout");
  redirect(`${await storeBase(handle)}/cart?saved=${full ? "full" : "moved"}`);
}

export type CodeState = { error?: string };

/** Apply a discount code in the cart. It's checked against the cart now and again at checkout. */
/** The cart's one code box takes discount codes and gift card codes. */
export async function applyCodeAction(handle: string, _: CodeState, form: FormData): Promise<CodeState> {
  const shop = await loadShop(handle);
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  if (!code) return { error: "Enter a code." };
  const lines = await readCart(shop.id);
  const buyerEmail = (await currentBuyer(shop.id))?.email ?? null;
  const giftCardCode = normalizeGiftCardCode(code);
  let giftError: string | null = null;
  try {
    if (giftCardCode) {
      try {
        await quoteCart(await db(), shop, lines, { buyerEmail, giftCardCode });
        await writeGiftCardCode(shop.id, giftCardCode);
        revalidatePath(`/s/${shop.handle}/cart`);
        return {};
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
        giftError = e.message; // it may still be a discount code that happens to look like one
      }
    }
    const cart = await quoteCart(await db(), shop, lines, { buyerEmail });
    if (cart.wholesale) return { error: giftError ?? "Discount codes don't apply to wholesale prices." };
    await quoteCart(await db(), shop, lines, { buyerEmail, discountCode: code });
  } catch (e) {
    if (e instanceof UserError) return { error: giftError ?? e.message };
    throw e;
  }
  await writeDiscountCode(shop.id, code);
  revalidatePath(`/s/${shop.handle}/cart`);
  return {};
}

export async function removeGiftCardAction(handle: string) {
  const shop = await loadShop(handle);
  await writeGiftCardCode(shop.id, null);
  redirect(`${await storeBase(handle)}/cart`);
}

export async function removeCodeAction(handle: string) {
  const shop = await loadShop(handle);
  await writeDiscountCode(shop.id, null);
  redirect(`${await storeBase(handle)}/cart`);
}

export type CheckoutState = { error?: string; values?: Record<string, string> };

export async function checkoutAction(handle: string, _: CheckoutState, form: FormData): Promise<CheckoutState> {
  const shop = await loadShop(handle);
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  let orderId: string;
  let paidRef: string | null = null;
  try {
    const { order, paidWithGiftCard } = await startCheckout(await db(), payments(), shop, {
      email: values.email ?? "",
      address: {
        name: values.name ?? "",
        line1: values.line1 ?? "",
        line2: values.line2 || undefined,
        city: values.city ?? "",
        region: values.region || undefined,
        postalCode: values.postalCode ?? "",
        country: values.country ?? "",
        phone: values.phone || undefined,
      },
      storefront: true,
      lines: await readCart(shop.id),
      discountCode: await readDiscountCode(shop.id),
      fx: await buyerFx(shop),
      acceptsMarketing: values.acceptsMarketing === "on",
      protection: values.protection === "on",
      giftWrap: values.giftWrap === "on",
      tipPercent: values.tipPercent ? Number(values.tipPercent) : null,
      ageConfirmed: values.ageConfirmed === "on",
      campaignId: (await cookies()).get(campaignCookie(shop.id))?.value ?? null,
      visitSource: await visitSource(await db(), shop.id, (await cookies()).get("sf_vid")?.value).catch(() => null),
      visitPostId: await visitPost(await db(), shop.id, (await cookies()).get("sf_vid")?.value).catch(() => null),
      buyerEmail: (await currentBuyer(shop.id))?.email ?? null,
      giftCardCode: await readGiftCardCode(shop.id),
      shippingRateId: values.shippingRateId || null,
      gift: values.gift === "on" ? { from: values.giftFrom ?? "", message: values.giftMessage, recipientEmail: values.giftRecipientEmail } : null,
      giftCardTo:
        values.giftCardTo === "on"
          ? { email: values.giftCardEmail ?? "", name: values.giftCardName, from: values.giftCardFrom ?? "", message: values.giftCardMessage, sendOn: values.giftCardSendOn }
          : null,
      note: values.note || null,
    }, tax());
    orderId = order.id;
    await track(shop.id, "checkout_start");
    // Paid in full by gift card: no card form, straight to the order.
    if (paidWithGiftCard) {
      afterOrderPaid(order.id);
      await writeCart(shop.id, []);
      await writeDiscountCode(shop.id, null);
      await writeGiftCardCode(shop.id, null);
      paidRef = order.paymentIntentId;
    }
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, values };
    throw e;
  }
  if (paidRef) redirect(`${await storeBase(handle)}/orders/${paidRef}`);
  redirect(`${await storeBase(handle)}/pay/${orderId}`);
}

/**
 * Test mode only: stands in for the card form. It sends a signed "payment succeeded" webhook
 * through the same verification and idempotency path Stripe's webhook uses.
 */
export async function fakePayAction(handle: string, orderId: string) {
  const provider = payments();
  if (!(provider instanceof FakePaymentProvider)) throw new Error("Test payments are off.");
  const shop = await loadShop(handle);
  const order = await getOrder(await db(), shop.id, orderId);
  const { body, signature } = provider.succeededEvent(order.paymentIntentId!, amountToCharge(order));
  await processPaymentWebhook(body, signature);
  await writeCart(shop.id, []);
  await writeDiscountCode(shop.id, null);
  await writeGiftCardCode(shop.id, null);
  redirect(`${await storeBase(handle)}/orders/${order.paymentIntentId}`);
}

/** The buyer will pay by bank transfer: the order waits for it, and they're shown where to send it. */
export async function payByTransferAction(handle: string, orderId: string) {
  const shop = await loadShop(handle);
  const order = await chooseBankTransfer(await fulfillment(), shop.id, orderId);
  await writeCart(shop.id, []);
  await writeDiscountCode(shop.id, null);
  await writeGiftCardCode(shop.id, null);
  redirect(`${await storeBase(handle)}/orders/${order.paymentIntentId}#transfer`);
}

export type QuestionState = { error?: string; sent?: boolean };

/** A buyer asks about their order from its status page. Buyer support answers after the response. */
export async function askAboutOrderAction(handle: string, ref: string, _: QuestionState, form: FormData): Promise<QuestionState> {
  const shop = await loadShop(handle);
  const ctx = await agents();
  let run: () => Promise<unknown>;
  try {
    ({ run } = await handleBuyerMessage(ctx, { shopId: shop.id, paymentIntentId: ref, body: String(form.get("message") ?? "") }));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  after(async () => {
    try {
      await run();
    } catch (e) {
      console.error("buyer support run failed", e);
    }
  });
  revalidatePath(`/s/${shop.handle}/orders/${ref}`);
  return { sent: true };
}

export type ReviewState = { error?: string; sent?: boolean; reward?: number | null };

/** A buyer reviews a product from their order status page (the link is their proof of purchase). */
export async function reviewAction(handle: string, ref: string, productId: string, _: ReviewState, form: FormData): Promise<ReviewState> {
  const shop = await loadShop(handle);
  let review: Awaited<ReturnType<typeof submitReview>>;
  try {
    review = await submitReview(await db(), shop, ref, {
      productId,
      rating: Number(form.get("rating") ?? 0),
      name: String(form.get("name") ?? ""),
      body: String(form.get("body") ?? ""),
    }, await Promise.all(form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0).map(async (f) => Buffer.from(await f.arrayBuffer()))));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  // The store's thank-you code, when it gives one. A failed email never loses the review.
  const reward = await rewardReview({ db: await db(), mailer: mailer(), storeAddress }, review.id).catch(() => null);
  revalidatePath(`/s/${shop.handle}/orders/${ref}`);
  return { sent: true, reward };
}

/** The buyer picks the currency to shop in. Stays for a year on this store. */
export async function setCurrencyAction(handle: string, form: FormData) {
  const shop = await loadShop(handle);
  const currency = String(form.get("currency") ?? "");
  const back = String(form.get("back") ?? "");
  if (shopCurrencies(shop).includes(currency)) {
    (await cookies()).set(currencyCookie(shop.id), currency, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400 });
  }
  const base = await storeBase(handle);
  redirect(back.startsWith("/") && !back.startsWith("//") ? back : base || "/");
}

/**
 * The email signup section. Someone already on the list sees the same "check your inbox" message,
 * so the form can't be used to find out who subscribes.
 */
export async function newsletterAction(handle: string, form: FormData) {
  const shop = await loadShop(handle);
  let status = "sent";
  try {
    await requestNewsletterSignup(await campaigns(), shop, String(form.get("email") ?? ""));
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    status = "invalid";
  }
  redirect(`${(await storeBase(handle)) || "/"}?signup=${status}#signup`);
}

/** The sign-up pop-up: the same confirm-by-email signup as the home page form, answered in place. */
export async function popupSignupAction(handle: string, _: { status?: "sent" | "invalid" }, form: FormData): Promise<{ status: "sent" | "invalid" }> {
  const shop = await loadShop(handle);
  try {
    await requestNewsletterSignup(await campaigns(), shop, String(form.get("email") ?? ""));
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    return { status: "invalid" };
  }
  return { status: "sent" };
}

/** The password page: lets a visitor in for 30 days when the password is right. */
export async function storePasswordAction(handle: string, form: FormData) {
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const key = await enterStorePassword(shop, String(form.get("password") ?? ""));
  if (!key) redirect(`${base}/password?wrong=1`);
  (await cookies()).set(storeAccessCookie(shop.id), key, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30 * 86_400 });
  redirect(base || "/");
}

/** The password page's "email me when you open" list: the store's own newsletter. */
export async function passwordSignupAction(handle: string, form: FormData) {
  const shop = await loadShop(handle);
  let status = "sent";
  try {
    await requestNewsletterSignup(await campaigns(), shop, String(form.get("email") ?? ""));
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    status = "invalid";
  }
  redirect(`${await storeBase(handle)}/password?signup=${status}`);
}

export type ContactState = { error?: string; sent?: boolean };

/** The contact page. Messages about one of the buyer's own orders go to buyer support first. */
export async function contactAction(handle: string, _: ContactState, form: FormData): Promise<ContactState> {
  const shop = await loadShop(handle);
  const get = (k: string) => String(form.get(k) ?? "");
  let sent: Awaited<ReturnType<typeof sendContactMessage>>;
  try {
    sent = await sendContactMessage(await db(), shop, { name: get("name"), email: get("email"), order: get("order"), message: get("message"), website: get("website") });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  if (sent?.orderId) {
    const { conversationId, orderId } = sent;
    after(async () => {
      try {
        await answerBuyer(await agents(), conversationId, orderId);
      } catch (e) {
        console.error("buyer support run failed", e);
      }
    });
  }
  return { sent: true };
}

/** "Track your order": emails the order's link to the address it was placed with, if there is one. */
export async function trackOrderAction(handle: string, form: FormData) {
  const shop = await loadShop(handle);
  let sent = "1";
  try {
    await requestOrderLink(await fulfillment(), shop, { email: String(form.get("email") ?? ""), number: String(form.get("number") ?? "") });
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    sent = "invalid";
  }
  redirect(`${await storeBase(handle)}/track?sent=${sent}`);
}

/** A buyer asks for an email when a sold-out option is back. */
export async function stockAlertAction(handle: string, productHandle: string, form: FormData) {
  const shop = await loadShop(handle);
  let status = "sent";
  try {
    await requestStockAlert(await db(), shop.id, { variantId: String(form.get("variantId") ?? ""), email: String(form.get("email") ?? "") });
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    status = e.code === "in_stock" ? "back" : e.code === "too_many" ? "many" : "invalid";
  }
  redirect(`${await storeBase(handle)}/products/${productHandle}?alert=${status}#stock-alert`);
}

/** Adds a product to the shopper's compare list, or takes it off. Comes back to where it was pressed. */
export async function toggleCompareAction(handle: string, productId: string, back: "product" | "compare", form: FormData) {
  const shop = await loadShop(handle);
  const on = form.get("on") === "1";
  const { ids, full } = toggleCompareId(await readCompare(shop.id), productId, on);
  if (!full) await writeCompare(shop.id, ids);
  const base = await storeBase(handle);
  if (back === "compare") redirect(`${base}/compare`);
  redirect(`${base}/products/${String(form.get("handle") ?? "")}?compare=${full ? "full" : on ? "added" : "removed"}#compare`);
}

/** Empties the compare list. */
export async function clearCompareAction(handle: string) {
  const shop = await loadShop(handle);
  await writeCompare(shop.id, []);
  redirect(`${await storeBase(handle)}/compare`);
}

/** A shopper asks to be emailed when a coming-soon product goes on sale. */
export async function launchListAction(handle: string, productHandle: string, productId: string, form: FormData) {
  const shop = await loadShop(handle);
  let status = "joined";
  try {
    await joinLaunchList(await db(), shop.id, productId, String(form.get("email") ?? ""));
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    status = "invalid";
  }
  redirect(`${await storeBase(handle)}/products/${productHandle}?launch=${status}#launch-list`);
}

/** A shopper asks about a product. The merchant answers from the admin and the answer comes by email. */
export async function askQuestionAction(handle: string, productHandle: string, productId: string, form: FormData) {
  const shop = await loadShop(handle);
  let status = "sent";
  try {
    await askQuestion(await db(), shop.id, { productId, name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), body: String(form.get("question") ?? "") });
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    status = e.code === "too_many" ? "many" : "invalid";
  }
  redirect(`${await storeBase(handle)}/products/${productHandle}?asked=${status}#questions`);
}

/** The heart on a product: saves it, or takes it off the list. Comes back to the page it was pressed on. */
export async function toggleSavedAction(handle: string, productId: string, back: "product" | "saved", form: FormData) {
  const shop = await loadShop(handle);
  const save = form.get("save") === "1";
  const buyer = await currentBuyer(shop.id);
  let status = save ? "saved" : "removed";
  if (buyer) {
    try {
      if (save) await saveItem(await db(), shop.id, buyer.id, productId);
      else await unsaveItem(await db(), buyer.id, productId);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      status = "full";
    }
  } else {
    const ids = (await readGuestSaved(shop.id)).filter((id) => id !== productId);
    if (save) {
      if (ids.length >= 50) status = "full";
      else ids.push(productId);
    }
    await writeGuestSaved(shop.id, ids);
  }
  revalidatePath(`/s/${handle}`, "layout");
  const base = await storeBase(handle);
  if (back === "saved") redirect(`${base}/saved`);
  const product = String(form.get("handle") ?? "");
  redirect(`${base}/products/${encodeURIComponent(product)}?saved=${status}`);
}

/** Signed-in buyers turn price-drop emails on or off from their Saved page. */
export async function priceAlertsAction(handle: string, on: boolean) {
  const shop = await loadShop(handle);
  const buyer = await currentBuyer(shop.id);
  if (buyer) await setPriceAlerts(await db(), shop.id, buyer.id, on);
  redirect(`${await storeBase(handle)}/saved`);
}

/** Signed-in buyers turn the share link for their saved list on or off. */
export async function shareSavedAction(handle: string, on: boolean) {
  const shop = await loadShop(handle);
  const buyer = await currentBuyer(shop.id);
  if (buyer) {
    if (on) await shareSaved(await db(), shop.id, buyer.id);
    else await stopSharingSaved(await db(), shop.id, buyer.id);
  }
  redirect(`${await storeBase(handle)}/saved`);
}

export type ReturnState = { error?: string };

/** The buyer asks to return items, from their order page. */
export async function returnAction(handle: string, ref: string, _: ReturnState, form: FormData): Promise<ReturnState> {
  const shop = await loadShop(handle);
  try {
    const order = await getOrderByPaymentIntent(await db(), shop.id, ref);
    await requestReturn(await db(), shop, order, {
      reason: String(form.get("reason") ?? "") as never,
      note: String(form.get("note") ?? ""),
      items: form.getAll("lineId").map((id) => ({ lineId: String(id), quantity: Number(form.get(`qty-${id}`) ?? 0) || 0, exchangeVariantId: String(form.get(`swap-${id}`) ?? "") || undefined })),
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect(`${await storeBase(handle)}/orders/${ref}`);
}

/** The buyer fixes their address or picks another size, from their order page, before it ships. */
export async function editOrderByBuyerAction(handle: string, ref: string, _: OrderEditState, form: FormData): Promise<OrderEditState> {
  const shop = await loadShop(handle);
  try {
    const order = await getOrderByPaymentIntent(await db(), shop.id, ref);
    await editOrder(await fulfillment(), shop.id, order.id, readOrderEdit(form), "buyer");
  } catch (e) {
    if (e instanceof UserError || e instanceof NotFoundError) return { error: e.message };
    throw e;
  }
  revalidatePath(`${await storeBase(handle)}/orders/${ref}`);
  return { message: "Saved. We've emailed you the change." };
}

export type CancelState = { error?: string; done?: boolean };

/** The buyer cancels their order from its page, before it ships, for a full refund. */
export async function cancelOrderByBuyerAction(handle: string, ref: string, _: CancelState, form: FormData): Promise<CancelState> {
  const shop = await loadShop(handle);
  try {
    const order = await getOrderByPaymentIntent(await db(), shop.id, ref);
    await cancelOrderByBuyer({ ...(await refunds()), adminUrl: platformUrl }, shop.id, order.id, { reason: String(form.get("reason") ?? "") });
  } catch (e) {
    if (e instanceof UserError || e instanceof NotFoundError) return { error: e.message };
    throw e;
  }
  revalidatePath(`${await storeBase(handle)}/orders/${ref}`);
  return { done: true };
}

export type ReferState = { sent?: string; error?: string };

/** A friend asks for their code from a refer-a-friend link. It's only ever emailed. */
export async function claimReferralAction(handle: string, code: string, _: ReferState, form: FormData): Promise<ReferState> {
  const shop = await loadShop(handle);
  const email = String(form.get("email") ?? "").trim();
  try {
    await claimReferral(await campaigns(), shop, code, email);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    return { error: e.code === "no_link" ? "gone" : "invalid" };
  }
  return { sent: email };
}

/** The buyer took the after-checkout offer on their order page. */
export async function acceptPostPurchaseAction(handle: string, ref: string, _: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const shop = await loadShop(handle);
  let added;
  try {
    added = await acceptPostPurchaseOffer({ db: await db(), payments: payments() }, shop, { orderRef: ref, variantId: String(form.get("variantId") ?? "") }, { taxCalculator: tax() });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  afterOrderPaid(added.id);
  revalidatePath(`/s/${handle}/orders/${ref}`);
  redirect(`${await storeBase(handle)}/orders/${ref}`);
}

/** The buyer subscribed to their order from its page. */
export async function startSubscriptionAction(handle: string, ref: string, _: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const shop = await loadShop(handle);
  try {
    await startSubscription(await subscriptions(), shop, { orderRef: ref, intervalDays: Number(form.get("intervalDays") ?? 0) });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/s/${handle}/orders/${ref}`);
  redirect(`${await storeBase(handle)}/orders/${ref}?subscribed=1`);
}

/** The buyer's answer to the store's survey on their order page. */
export async function answerSurveyAction(handle: string, ref: string, _: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const shop = await loadShop(handle);
  try {
    await answerSurvey(await db(), shop, ref, { answer: String(form.get("answer") ?? ""), other: String(form.get("other") ?? "") });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/s/${handle}/orders/${ref}`);
  redirect(`${await storeBase(handle)}/orders/${ref}?answered=1`);
}

/** Skip, change how often, pause, resume or cancel, from the subscription's page. */
export async function changeSubscriptionAction(handle: string, token: string, _: { error?: string; done?: string }, form: FormData): Promise<{ error?: string; done?: string }> {
  const shop = await loadShop(handle);
  const type = String(form.get("change") ?? "");
  const change: SubscriptionChange | null =
    type === "interval" ? { type, days: Number(form.get("intervalDays") ?? 0) } : type === "skip" || type === "pause" || type === "resume" || type === "cancel" ? { type } : null;
  if (!change) return { error: "Something went wrong. Try again." };
  try {
    await changeSubscription(await db(), shop, token, change);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/s/${handle}/subscriptions/${token}`);
  const done = { interval: "Saved. Your next delivery date has moved to match.", skip: "Skipped. Your next delivery date is below.", pause: "Paused. Nothing will be sent or charged until you resume.", resume: "Resumed. Your next delivery date is below.", cancel: "Cancelled. You won't be charged again." }[change.type];
  return { done };
}

/** Keeps a device's "helpful" marks apart from other devices': a random id, only set once a shopper taps one. */
const VOTER_COOKIE = "sf_voter";

/**
 * Marks a review helpful, or takes the mark back, then returns to the same review in the same list.
 * The list (stars, order, all) comes from the page, so it's checked again here.
 */
/** This device's random id for helpful votes and reports, set on its first one. */
async function voterId() {
  const jar = await cookies();
  let voter = jar.get(VOTER_COOKIE)?.value;
  if (!voter || !VOTER_PATTERN.test(voter)) {
    voter = randomBytes(16).toString("base64url");
    jar.set(VOTER_COOKIE, voter, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return voter;
}

type ReviewView = { stars?: unknown; photos?: unknown; sort?: unknown; all?: unknown };

/** Back to the review on the product page, with the shopper's filters kept. */
async function backToReview(handle: string, productHandle: string, reviewId: string, view: ReviewView, found: boolean): Promise<never> {
  // The redirect can differ from the page only after the #, which the router treats as a scroll,
  // so ask for the page's fresh data too.
  revalidatePath(`/s/${handle}/products/${productHandle}`);
  const list = reviewsQuery({ stars: starsFilter(String(view?.stars ?? "")), photos: view?.photos === true, sort: reviewSort(String(view?.sort ?? "")), all: view?.all === true });
  redirect(`${await storeBase(handle)}/products/${encodeURIComponent(productHandle)}${list}#${found ? `review-${reviewId}` : "reviews"}`);
}

const unlessGone = (e: unknown) => {
  if (e instanceof NotFoundError) return false;
  throw e;
};

export async function helpfulAction(handle: string, productHandle: string, reviewId: string, view: ReviewView) {
  const shop = await loadShop(handle);
  const found = await toggleHelpful(await db(), shop.id, reviewId, await voterId()).then(() => true, unlessGone);
  await backToReview(handle, productHandle, reviewId, view, found);
}

export async function reportReviewAction(handle: string, productHandle: string, reviewId: string, view: ReviewView) {
  const shop = await loadShop(handle);
  const found = await reportReview(await db(), shop.id, reviewId, await voterId()).then(() => true, unlessGone);
  await backToReview(handle, productHandle, reviewId, view, found);
}

