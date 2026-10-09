"use client";
import { useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

const loaded = new Map<string, Promise<Stripe | null>>();
const stripeFor = (key: string) => {
  if (!loaded.has(key)) loaded.set(key, loadStripe(key));
  return loaded.get(key)!;
};

/** Stripe's card form (with Apple Pay and Google Pay where the device offers them). */
type Text = { paying: string; note: string; failed: string };

export function CardForm({ publishableKey, clientSecret, returnUrl, payLabel, locale, text }: { publishableKey: string; clientSecret: string; returnUrl: string; payLabel: string; locale: string; text: Text }) {
  return (
    <Elements stripe={stripeFor(publishableKey)} options={{ clientSecret, locale: locale as "auto", appearance: { theme: "stripe", variables: { borderRadius: "8px" } } }}>
      <Inner returnUrl={returnUrl} payLabel={payLabel} text={text} />
    </Elements>
  );
}

function Inner({ returnUrl, payLabel, text }: { returnUrl: string; payLabel: string; text: Text }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card p-5 flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setBusy(true);
        setError(null);
        const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl } });
        // Only reached when the payment didn't go through; on success Stripe sends the buyer to returnUrl.
        setError(result.error?.message ?? text.failed);
        setBusy(false);
      }}
    >
      <PaymentElement />
      {error && <p role="alert" className="banner banner-critical">{error}</p>}
      <button type="submit" className="btn btn-primary btn-lg" disabled={!stripe || busy} aria-busy={busy}>
        {busy ? text.paying : payLabel}
      </button>
      <p className="hint text-center">{text.note}</p>
    </form>
  );
}
