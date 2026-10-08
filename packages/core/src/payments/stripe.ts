import Stripe from "stripe";
import { UserError } from "../errors";
import type { PaymentEvent, PaymentProvider, PayoutAccountStatus, ProviderPayout } from "./provider";

export type StripePrices = Partial<Record<"starter" | "growth" | "scale", string>>;

/**
 * Stripe Connect destination charges: the buyer pays the platform, funds go to the shop's
 * Express account, and on the free plan our 2% is taken as an application fee. Plans are
 * Stripe Billing subscriptions. Not exercised until Stripe keys are set.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    private readonly prices: StripePrices = {},
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async createPaymentIntent(input: {
    amountMinor: number;
    currency: string;
    shopAccountId: string | null;
    applicationFeeMinor: number;
    metadata: Record<string, string>;
  }) {
    if (!input.shopAccountId) throw new UserError("This store hasn't finished payout setup yet.", "payouts_not_ready");
    const pi = await this.stripe.paymentIntents.create({
      amount: input.amountMinor,
      currency: input.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      transfer_data: { destination: input.shopAccountId },
      application_fee_amount: input.applicationFeeMinor > 0 ? input.applicationFeeMinor : undefined,
      metadata: input.metadata,
    });
    return { id: pi.id, clientSecret: pi.client_secret! };
  }

  async clientSecret(paymentIntentId: string) {
    const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    return pi.client_secret!;
  }

  async refund(input: { paymentIntentId: string; amountMinor: number; reason: string | null }) {
    const r = await this.stripe.refunds.create({
      payment_intent: input.paymentIntentId,
      amount: input.amountMinor,
      // Take the money back from the merchant's account and give back our fee in proportion.
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: input.reason ? { reason: input.reason.slice(0, 450) } : undefined,
    });
    return { id: r.id };
  }

  async createPayoutAccount(input: { shopId: string; country: string; email: string }) {
    const account = await this.stripe.accounts.create({
      type: "express",
      country: input.country,
      email: input.email,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { shopId: input.shopId },
    });
    return { accountId: account.id };
  }

  async payoutOnboardingUrl(input: { accountId: string; returnUrl: string; refreshUrl: string }) {
    const link = await this.stripe.accountLinks.create({
      account: input.accountId,
      return_url: input.returnUrl,
      refresh_url: input.refreshUrl,
      type: "account_onboarding",
    });
    return link.url;
  }

  async getPayoutAccount(accountId: string) {
    return accountStatus(await this.stripe.accounts.retrieve(accountId));
  }

  async submitDocument(input: { accountId: string; requirementKey: string; fileName: string; contentType: string; data: Buffer }) {
    const side = input.requirementKey.endsWith("additional_document") ? "additional_document" : "document";
    if (!input.requirementKey.includes("verification.")) {
      throw new UserError("Send this one through Stripe: press Update details on this card.");
    }
    const file = await this.stripe.files.create(
      { purpose: "identity_document", file: { data: input.data, name: input.fileName, type: input.contentType } },
      { stripeAccount: input.accountId },
    );
    const person = input.requirementKey.startsWith("company.") ? "company" : "individual";
    await this.stripe.accounts.update(input.accountId, { [person]: { verification: { [side]: { front: file.id } } } } as Stripe.AccountUpdateParams);
    return { fileId: file.id };
  }

  async planCheckoutUrl(input: { shopId: string; plan: string; customerId: string | null; subscriptionId: string | null; email: string; returnUrl: string }) {
    // Existing subscribers change or cancel their plan in Stripe's billing portal.
    if (input.subscriptionId && input.customerId) {
      const portal = await this.stripe.billingPortal.sessions.create({ customer: input.customerId, return_url: input.returnUrl });
      return portal.url;
    }
    if (input.plan === "free") return null;
    const price = this.prices[input.plan as keyof StripePrices];
    if (!price) throw new Error(`No Stripe price set for the ${input.plan} plan (STRIPE_PRICE_${input.plan.toUpperCase()}).`);
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      customer: input.customerId ?? undefined,
      customer_email: input.customerId ? undefined : input.email,
      subscription_data: { metadata: { shopId: input.shopId }, trial_period_days: 14 },
      success_url: `${input.returnUrl}?plan=updated`,
      cancel_url: input.returnUrl,
    });
    return session.url;
  }

  async parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent | null> {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature ?? "", this.webhookSecret);
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object;
        return { id: event.id, type: "payment.succeeded", paymentIntentId: pi.id, amountMinor: pi.amount_received };
      }
      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        return { id: event.id, type: "payment.failed", paymentIntentId: pi.id, reason: pi.last_payment_error?.message ?? "Payment failed" };
      }
      case "account.updated":
        return { id: event.id, type: "account.updated", accountId: event.data.object.id, status: accountStatus(event.data.object) };
      case "payout.created":
      case "payout.updated":
      case "payout.paid":
      case "payout.failed":
      case "payout.canceled":
        if (!event.account) return null;
        return { id: event.id, type: "payout.updated", accountId: event.account, payout: payoutOf(event.data.object) };
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const shopId = sub.metadata?.shopId;
        if (!shopId) return null;
        const live = event.type !== "customer.subscription.deleted" && ["active", "trialing", "past_due"].includes(sub.status);
        const priceId = sub.items.data[0]?.price.id;
        const plan = live ? (Object.entries(this.prices).find(([, id]) => id === priceId)?.[0] ?? null) : null;
        return {
          id: event.id,
          type: "plan.updated",
          shopId,
          plan,
          customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
          subscriptionId: live ? sub.id : null,
        };
      }
      default:
        return null;
    }
  }
}

function accountStatus(a: Stripe.Account): PayoutAccountStatus {
  const r = a.requirements;
  const deadline = r?.current_deadline ? new Date(r.current_deadline * 1000) : null;
  const pastDue = new Set(r?.past_due ?? []);
  const due = [...new Set([...(r?.past_due ?? []), ...(r?.currently_due ?? [])])];
  return {
    chargesEnabled: a.charges_enabled ?? false,
    payoutsEnabled: a.payouts_enabled ?? false,
    disabledReason: r?.disabled_reason ?? null,
    requirements: due.map((key) => ({ key, dueBy: pastDue.has(key) ? null : deadline, holdsPayouts: pastDue.has(key) || !a.payouts_enabled })),
  };
}

function payoutOf(p: Stripe.Payout): ProviderPayout {
  return {
    id: p.id,
    amountMinor: p.amount,
    currency: p.currency.toUpperCase(),
    status: p.status as ProviderPayout["status"],
    arrivalDate: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString().slice(0, 10) : null,
    failureReason: p.failure_message ?? null,
  };
}
