import { processPaymentWebhook } from "@/lib/webhooks";

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("stripe-signature") ?? request.headers.get("x-fake-signature");
  try {
    const result = await processPaymentWebhook(raw, signature);
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "error";
    // A bad signature is the sender's fault; anything else should be retried by the provider.
    return Response.json({ error: message }, { status: /signature/i.test(message) ? 400 : 500 });
  }
}
