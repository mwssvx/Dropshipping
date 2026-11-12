import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, emailText, handlePaymentEvent, onOrderPaid, startCheckout, syncTracking } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Lena Berger", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("order emails in the buyer's language", () => {
  it("sends the confirmation and shipping emails in the store language the buyer checked out in", async () => {
    const f = await makeFixture(new DemoModel());
    await f.setShop({ languages: ["de"] });
    const shop = await f.shop();
    const [v] = await f.variants(f.products.lamp.id);
    async function buy(language: string | null) {
      const { order } = await startCheckout(f.db, f.payments, shop, { email: `${language ?? "en"}@example.com`, address, lines: [{ variantId: v!.id, quantity: 1 }], language });
      const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
      await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
      await onOrderPaid(f.ctx, order.id);
      return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
    }
    const german = await buy("de");
    expect(german.language).toBe("de");
    // A language the store doesn't offer isn't kept.
    expect((await buy("fr")).language).toBeNull();
    const english = await buy(null);

    const to = (email: string) => f.mailer.sent.filter((m) => m.to === email);
    const confirmation = to("de@example.com").find((m) => m.subject === `Bestellung #${german.number} bestätigt`)!;
    expect(confirmation.text).toContain("Hallo Lena,");
    expect(confirmation.text).toContain(`Danke für deine Bestellung bei ${shop.name}.`);
    expect(confirmation.text).toContain("Wir schreiben dir wieder, sobald sie versendet ist.");
    expect(to("en@example.com").map((m) => m.subject)).toContain(`Order #${english.number} confirmed`);
    expect(to("fr@example.com").map((m) => m.subject).some((s) => s.endsWith("confirmed"))).toBe(true);

    f.advance(24 * 60 * 60 * 1000 + 1);
    await syncTracking(f.ctx, { orderId: german.id });
    const shipped = to("de@example.com").find((m) => m.subject === `Bestellung #${german.number} ist unterwegs`)!;
    expect(shipped.text).toContain(`Gute Nachricht: Deine Bestellung bei ${shop.name} wurde versendet.`);
    expect(shipped.text).toContain("Bestellstatus: ");
  });

  it("has every line in every language", () => {
    const keys = Object.keys(emailText(null)).sort();
    for (const lang of ["de", "fr", "es", "it", "nl"]) {
      expect(Object.keys(emailText(lang)).sort()).toEqual(keys);
      expect(emailText(lang).locale).not.toBe("en-US");
    }
  });
});
