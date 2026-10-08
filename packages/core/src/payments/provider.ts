export type PaymentIntent = { id: string; clientSecret: string };

export type PaymentEvent =
  | { id: string; type: "payment.succeeded"; paymentIntentId: string; amountMinor: number }
  | { id: string; type: "payment.failed"; paymentIntentId: string; reason: string };

/**
 * Payments behind one interface. "fake" runs everything locally for development and tests.
 * "stripe" uses Stripe (Connect + Payment Element) once keys are set.
 */
export interface PaymentProvider {
  readonly name: "fake" | "stripe";
  createPaymentIntent(input: {
    amountMinor: number;
    currency: string;
    shopAccountId: string | null;
    metadata: Record<string, string>;
  }): Promise<PaymentIntent>;
  /** Verify and normalise a webhook. Throws if the signature is wrong. Returns null for events we ignore. */
  parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent | null>;
}
