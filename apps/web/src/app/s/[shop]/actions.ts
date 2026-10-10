"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { amountToCharge, askQuestion, claimReferral, getOrder, NotFoundError, pickAddonVariant, pickBundleVariants, getOrderByPaymentIntent, normalizeGiftCardCode, requestReturn, recordEvent, handleBuyerMessage, quoteCart, requestNewsletterSignup, requestOrderLink, requestStockAlert, saveItem, setPriceAlerts, shopCurrencies, unsaveItem, startCheckout, submitReview, FakePaymentProvider, UserError } from "@sf/core";
import { readCart, readDiscountCode, readGiftCardCode, writeCart, writeDiscountCode, writeGiftCardCode } from "@/lib/cart";
import { agents, campaigns, db, fulfillment, payments, tax } from "@/lib/server";
import { afterOrderPaid, processPaymentWebhook } from "@/lib/webhooks";
import { loadShop, storeBase } from "./data";
import { buyerFx, currencyCookie } from "@/lib/currency";
import { campaignCookie } from "@/lib/campaigns";
import { currentBuyer } from "@/lib/buyer";
import { readGuestSaved, writeGuestSaved } from "@/lib/saved";

/** The visit id the store's tracker set, for the funnel. */
async function track(shopId: string, kind: "add_to_cart" | "checkout_start", productId?: string | null) {
  const sessionId = (await cookies()).get("sf_vid")?.value;
  if (!sessionId) return;
  after(async () => {
    await recordEvent(await db(), shopId, { sessionId, kind, productId }).catch(() => {});
  });
}

export async function addToCartAction(handle: string, form: FormData) {
  const shop = await loadShop(handle);
  const variantId = String(form.get("variantId") ?? "");
  const quantity = Math.min(99, Math.max(1, Number(form.get("quantity") ?? 1) || 1));
  const cart = await readCart(shop.id);
  const line = cart.find((l) => l.variantId === variantId);
  if (line) line.quantity = Math.min(99, line.quantity + quantity);
  else cart.push({ variantId, quantity });
  await writeCart(shop.id, cart);
  const variant = await (await db()).query.variants.findFirst({ where: (v, { eq }) => eq(v.id, variantId), columns: { productId: true } }).catch(() => undefined);
  await track(shop.id, "add_to_cart", variant?.productId);
  redirect(`${await storeBase(handle)}/cart`);
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
  redirect(`${base}/cart`);
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
  const variantId = String(form.get("variantId") ?? "");
  const quantity = Math.min(99, Math.max(0, Number(form.get("quantity") ?? 0) || 0));
  const cart = (await readCart(shop.id)).map((l) => (l.variantId === variantId ? { ...l, quantity } : l));
  await writeCart(shop.id, cart);
  redirect(`${await storeBase(handle)}/cart`);
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
      },
      lines: await readCart(shop.id),
      discountCode: await readDiscountCode(shop.id),
      fx: await buyerFx(shop),
      acceptsMarketing: values.acceptsMarketing === "on",
      campaignId: (await cookies()).get(campaignCookie(shop.id))?.value ?? null,
      buyerEmail: (await currentBuyer(shop.id))?.email ?? null,
      giftCardCode: await readGiftCardCode(shop.id),
      shippingRateId: values.shippingRateId || null,
      gift: values.gift === "on" ? { from: values.giftFrom ?? "", message: values.giftMessage, recipientEmail: values.giftRecipientEmail } : null,
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

export type ReviewState = { error?: string; sent?: boolean };

/** A buyer reviews a product from their order status page (the link is their proof of purchase). */
export async function reviewAction(handle: string, ref: string, productId: string, _: ReviewState, form: FormData): Promise<ReviewState> {
  const shop = await loadShop(handle);
  try {
    await submitReview(await db(), shop, ref, {
      productId,
      rating: Number(form.get("rating") ?? 0),
      name: String(form.get("name") ?? ""),
      body: String(form.get("body") ?? ""),
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/s/${shop.handle}/orders/${ref}`);
  return { sent: true };
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

export type ReturnState = { error?: string };

/** The buyer asks to return items, from their order page. */
export async function returnAction(handle: string, ref: string, _: ReturnState, form: FormData): Promise<ReturnState> {
  const shop = await loadShop(handle);
  try {
    const order = await getOrderByPaymentIntent(await db(), shop.id, ref);
    await requestReturn(await db(), shop, order, {
      reason: String(form.get("reason") ?? "") as never,
      note: String(form.get("note") ?? ""),
      items: form.getAll("lineId").map((id) => ({ lineId: String(id), quantity: Number(form.get(`qty-${id}`) ?? 0) || 0 })),
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect(`${await storeBase(handle)}/orders/${ref}`);
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
