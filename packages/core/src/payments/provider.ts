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

/** A chargeback, or an inquiry before one, as the provider reports it. */
export type ProviderDispute = {
  id: string;
  paymentIntentId: string;
  amountMinor: number;
  currency: string;
  reason: string;
  status: "needs_response" | "under_review" | "won" | "lost" | "closed";
  inquiry: boolean;
  evidenceDueBy: Date | null;
};

/** What we send the card network to answer a dispute. */
export type DisputeEvidence = {
  customerName: string;
  customerEmail: string;
  shippingAddress: string;
  productDescription: string;
  shippingCarrier: string | null;
  shippingTrackingNumber: string | null;
  /** YYYY-MM-DD */
  shippingDate: string | null;
  refundPolicy: string | null;
  /** Everything else: delivery status, messages with the buyer, the merchant's note. */
  uncategorizedText: string;
};

export type PaymentEvent =
  | { id: string; type: "payment.succeeded"; paymentIntentId: string; amountMinor: number }
  | { id: string; type: "payment.failed"; paymentIntentId: string; reason: string }
  | { id: string; type: "account.updated"; accountId: string; status: PayoutAccountStatus }
  | { id: string; type: "payout.updated"; accountId: string; payout: ProviderPayout }
  | { id: string; type: "plan.updated"; shopId: string; plan: string | null; customerId: string; subscriptionId: string | null }
  | { id: string; type: "dispute.updated"; dispute: ProviderDispute };

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
    /** Keep the card for one more charge right after checkout (the after-checkout offer). */
    saveCard?: { email: string };
  }): Promise<PaymentIntent>;
  /**
   * Charge the card used for an earlier payment again, with the buyer present but without them
   * typing it in. Throws a UserError when the card is declined or the bank wants a check.
   */
  chargeSavedCard(input: {
    fromPaymentIntentId: string;
    amountMinor: number;
    currency: string;
    shopAccountId: string | null;
    applicationFeeMinor: number;
    metadata: Record<string, string>;
  }): Promise<{ id: string }>;
  /** The secret the browser's card form needs to finish paying for an order. */
  clientSecret(paymentIntentId: string): Promise<string>;
  /** Verify and normalise a webhook. Throws if the signature is wrong. Returns null for events we ignore. */
  parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent | null>;

  /** Sends the evidence for a dispute and submits it; nothing can be added afterwards. */
  submitDisputeEvidence(input: { disputeId: string; evidence: DisputeEvidence }): Promise<void>;
  /** Gives up a dispute: the buyer keeps the money back. */
  acceptDispute(disputeId: string): Promise<void>;

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
