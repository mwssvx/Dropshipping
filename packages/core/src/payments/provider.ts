export type PaymentIntent = { id: string; clientSecret: string };

/** Something the payment provider needs from the merchant, as the provider names it. */
export type ProviderRequirement = { key: string; dueBy: Date | null; holdsPayouts: boolean };

export type PayoutAccountStatus = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirements: ProviderRequirement[];
  /** Why the provider paused the account, in its own words (e.g. "under_review"), if it did. */
  disabledReason: string | null;
};

export type ProviderPayout = {
  id: string;
  amountMinor: number;
  currency: string;
  status: "pending" | "in_transit" | "paid" | "failed" | "canceled";
  arrivalDate: string | null;
  failureReason: string | null;
};

export type PaymentEvent =
  | { id: string; type: "payment.succeeded"; paymentIntentId: string; amountMinor: number }
  | { id: string; type: "payment.failed"; paymentIntentId: string; reason: string }
  | { id: string; type: "account.updated"; accountId: string; status: PayoutAccountStatus }
  | { id: string; type: "payout.updated"; accountId: string; payout: ProviderPayout }
  | { id: string; type: "plan.updated"; shopId: string; plan: string | null; customerId: string; subscriptionId: string | null };

/**
 * Payments behind one interface. "fake" runs everything locally for development and tests.
 * "stripe" uses Stripe Connect (Express accounts, destination charges) and Stripe Billing.
 */
export interface PaymentProvider {
  readonly name: "fake" | "stripe";
  createPaymentIntent(input: {
    amountMinor: number;
    currency: string;
    shopAccountId: string | null;
    /** Our cut (free plan). Taken from the payment before it reaches the merchant. */
    applicationFeeMinor: number;
    metadata: Record<string, string>;
  }): Promise<PaymentIntent>;
  /** Verify and normalise a webhook. Throws if the signature is wrong. Returns null for events we ignore. */
  parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent | null>;

  /** Refund part or all of a payment. Our sales fee is refunded in proportion. */
  refund(input: { paymentIntentId: string; amountMinor: number; reason: string | null }): Promise<{ id: string }>;

  /** Creates the merchant's payout account. */
  createPayoutAccount(input: { shopId: string; country: string; email: string }): Promise<{ accountId: string }>;
  /** Where the merchant goes to enter bank and identity details. */
  payoutOnboardingUrl(input: { accountId: string; returnUrl: string; refreshUrl: string }): Promise<string>;
  getPayoutAccount(accountId: string): Promise<PayoutAccountStatus>;
  /** Sends a document the provider asked for. */
  submitDocument(input: { accountId: string; requirementKey: string; fileName: string; contentType: string; data: Buffer }): Promise<{ fileId: string }>;

  /** Starts a plan change. Returns a page to pay on, or null when the change applies at once. */
  planCheckoutUrl(input: {
    shopId: string;
    plan: string;
    customerId: string | null;
    subscriptionId: string | null;
    email: string;
    returnUrl: string;
  }): Promise<string | null>;
}
