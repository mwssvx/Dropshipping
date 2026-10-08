import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PaymentEvent, PaymentProvider, PayoutAccountStatus } from "./provider";

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
    return JSON.parse(rawBody) as PaymentEvent;
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
