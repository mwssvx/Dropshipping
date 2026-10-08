import Stripe from "stripe";
import type { PaymentEvent, PaymentProvider } from "./provider";

/**
 * Stripe Connect destination charges: the buyer pays the platform, funds go to the shop's
 * connected account, and we take no application fee (the plan price is our revenue).
 * Not exercised until STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set (milestone 4).
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async createPaymentIntent(input: {
    amountMinor: number;
    currency: string;
    shopAccountId: string | null;
    metadata: Record<string, string>;
  }) {
    if (!input.shopAccountId) throw new Error("This store hasn't finished payout setup yet.");
    const pi = await this.stripe.paymentIntents.create({
      amount: input.amountMinor,
      currency: input.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      transfer_data: { destination: input.shopAccountId },
      metadata: input.metadata,
    });
    return { id: pi.id, clientSecret: pi.client_secret! };
  }

  async parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent | null> {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature ?? "", this.webhookSecret);
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      return { id: event.id, type: "payment.succeeded", paymentIntentId: pi.id, amountMinor: pi.amount_received };
    }
    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object;
      return {
        id: event.id,
        type: "payment.failed",
        paymentIntentId: pi.id,
        reason: pi.last_payment_error?.message ?? "Payment failed",
      };
    }
    return null;
  }
}
