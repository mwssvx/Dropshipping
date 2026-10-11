import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { UserError } from "../errors";
import type { DisputeEvidence, PaymentEvent, PaymentProvider, PayoutAccountStatus, ProviderDispute } from "./provider";

/**
 * A local stand-in for Stripe. It signs its own webhooks with a dev secret so the webhook
 * path, signature check and idempotency are exercised exactly like production. Payout accounts
 * are ready as soon as they're created, and plan changes apply at once.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake" as const;
  constructor(private readonly secret = "dev-fake-webhook-secret") {}

  async createPaymentIntent() {
    const id = `fake_pi_${randomUUID()}`;
    return { id, clientSecret: `${id}_secret` };
  }

  /** Tests set this to have the next saved-card charge declined. */
  declineNextCharge = false;

  async chargeSavedCard() {
    if (this.declineNextCharge) {
      this.declineNextCharge = false;
      throw new UserError("Your card was declined: insufficient funds.", "card_declined");
    }
    return { id: `fake_pi_${randomUUID()}` };
  }

  /** Evidence sent for each dispute, and disputes given up, for tests. */
  readonly disputeEvidence = new Map<string, DisputeEvidence>();
  readonly acceptedDisputes = new Set<string>();

  async submitDisputeEvidence(input: { disputeId: string; evidence: DisputeEvidence }) {
    this.disputeEvidence.set(input.disputeId, input.evidence);
  }

  async acceptDispute(disputeId: string) {
    this.acceptedDisputes.add(disputeId);
  }

  /** Build a signed dispute event, as the card network would cause. */
  disputeEvent(dispute: Partial<ProviderDispute> & Pick<ProviderDispute, "paymentIntentId" | "amountMinor">) {
    return this.event({
      id: `fake_evt_${randomUUID()}`,
      type: "dispute.updated",
      dispute: {
        id: `fake_dp_${randomUUID()}`,
        currency: "USD",
        reason: "product_not_received",
        status: "needs_response",
        inquiry: false,
        evidenceDueBy: new Date(Date.now() + 7 * 86_400_000),
        ...dispute,
      },
    });
  }

  async clientSecret(paymentIntentId: string) {
    return `${paymentIntentId}_secret`;
  }

  sign(rawBody: string) {
    return createHmac("sha256", this.secret).update(rawBody).digest("hex");
  }

  /** Build a signed "payment succeeded" webhook, as Stripe would send. */
  succeededEvent(paymentIntentId: string, amountMinor: number) {
    return this.event({ id: `fake_evt_${randomUUID()}`, type: "payment.succeeded", paymentIntentId, amountMinor });
  }

  /** Build any signed event, for tests. */
  event(e: PaymentEvent) {
    const body = JSON.stringify(e);
    return { body, signature: this.sign(body) };
  }

  async parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent | null> {
    const expected = Buffer.from(this.sign(rawBody));
    const got = Buffer.from(signature ?? "");
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new Error("Bad webhook signature");
    const event = JSON.parse(rawBody) as PaymentEvent;
    // Dates don't survive JSON.
    if (event.type === "dispute.updated" && event.dispute.evidenceDueBy) event.dispute.evidenceDueBy = new Date(event.dispute.evidenceDueBy);
    return event;
  }

  async refund() {
    return { id: `fake_re_${randomUUID()}` };
  }

  async createPayoutAccount() {
    return { accountId: `fake_acct_${randomUUID()}` };
  }

  async payoutOnboardingUrl(input: { returnUrl: string }) {
    // No form to fill in: the merchant comes straight back with a ready account.
    return input.returnUrl;
  }

  async getPayoutAccount(): Promise<PayoutAccountStatus> {
    return { chargesEnabled: true, payoutsEnabled: true, requirements: [], disabledReason: null };
  }

  async submitDocument() {
    return { fileId: `fake_file_${randomUUID()}` };
  }

  async planCheckoutUrl() {
    return null;
  }
}
