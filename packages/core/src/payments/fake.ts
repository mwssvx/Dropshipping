import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PaymentEvent, PaymentProvider } from "./provider";

/**
 * A local stand-in for Stripe. It signs its own webhooks with a dev secret so the webhook
 * path, signature check and idempotency are exercised exactly like production.
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
    const body = JSON.stringify({
      id: `fake_evt_${randomUUID()}`,
      type: "payment.succeeded",
      paymentIntentId,
      amountMinor,
    } satisfies PaymentEvent);
    return { body, signature: this.sign(body) };
  }

  async parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent | null> {
    const expected = Buffer.from(this.sign(rawBody));
    const got = Buffer.from(signature ?? "");
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new Error("Bad webhook signature");
    return JSON.parse(rawBody) as PaymentEvent;
  }
}
