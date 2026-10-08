import { FakePaymentProvider } from "./fake";
import type { PaymentProvider } from "./provider";
import { StripePaymentProvider } from "./stripe";

export * from "./provider";
export { FakePaymentProvider } from "./fake";
export { StripePaymentProvider } from "./stripe";

export function paymentProviderFromEnv(env: Record<string, string | undefined>): PaymentProvider {
  if (env.PAYMENTS_PROVIDER === "stripe") {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
      throw new Error("PAYMENTS_PROVIDER=stripe needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET");
    }
    return new StripePaymentProvider(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
  }
  return new FakePaymentProvider(env.FAKE_WEBHOOK_SECRET);
}
