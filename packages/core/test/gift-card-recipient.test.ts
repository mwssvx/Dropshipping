import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { amountToCharge, createGiftCardProduct, DemoModel, findGiftCard, handlePaymentEvent, onOrderPaid, resendGiftCard, sendScheduledGiftCards, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const codesIn = (text: string) => [...text.matchAll(/Gift card code: (\S+)/g)].map((m) => m[1]!);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const product = await createGiftCardProduct(f.db, shop, [2500, 5000]);
  const [, fifty] = await f.variants(product.id);
  const [lamp] = await f.variants(f.products.lamp.id);
  const gc = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example" };
  async function pay(order: { id: string; paymentIntentId: string | null; totalMinor: number; giftCardMinor: number; presentment: null | { totalMinor: number } }) {
    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: amountToCharge(order as never) });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);
  }
  return { ...f, shop, fifty: fifty!, lamp: lamp!, gc, pay };
}

describe("sending a gift card to someone else", () => {
  it("the code goes straight to the recipient with the message, and the buyer hears where it went", async () => {
    const f = await setup();
    const { order } = await startCheckout(f.db, f.payments, f.shop, {
      email: "giver@example.com",
      address,
      lines: [{ variantId: f.fifty.id, quantity: 1 }],
      giftCardTo: { email: " Sam@Example.com ", name: "Sam", from: "Ada", message: "Happy birthday!" },
    });
    expect(order.giftCardDelivery).toEqual({ email: "sam@example.com", name: "Sam", from: "Ada", message: "Happy birthday!", sendOn: null });
    await f.pay(order);
    const toSam = f.mailer.sent.filter((m) => m.to === "sam@example.com");
    expect(toSam).toHaveLength(1);
    expect(toSam[0]!.subject).toBe("Ada sent you a $50.00 gift card for Glow Lamps");
    expect(toSam[0]!.text).toContain("Hi Sam,");
    expect(toSam[0]!.text).toContain("Message from Ada: Happy birthday!");
    const code = codesIn(toSam[0]!.text)[0]!;
    await expect(findGiftCard(f.db, f.shop, code)).resolves.toMatchObject({ email: "sam@example.com", balanceMinor: 5000, note: "Happy birthday!" });
    // The buyer gets no code, only word that it went out.
    const toBuyer = f.mailer.sent.filter((m) => m.to === "giver@example.com" && m.subject.includes("gift card"));
    expect(toBuyer.map((m) => m.subject)).toEqual(["Your gift card for Sam from Glow Lamps"]);
    expect(toBuyer[0]!.text).toContain("went to sam@example.com, with your message");
    expect(codesIn(toBuyer[0]!.text)).toEqual([]);
  });

  it("a card for a later day waits, then goes out with a fresh code on that day, once", async () => {
    const f = await setup();
    const sendOn = day(10);
    const { order } = await startCheckout(f.db, f.payments, f.shop, {
      email: "giver@example.com",
      address,
      lines: [{ variantId: f.fifty.id, quantity: 2 }],
      giftCardTo: { email: "sam@example.com", from: "Ada", sendOn },
    });
    await f.pay(order);
    expect(f.mailer.sent.filter((m) => m.to === "sam@example.com")).toHaveLength(0);
    const note = f.mailer.sent.find((m) => m.to === "giver@example.com" && m.subject.includes("gift card"))!;
    expect(note.text).toContain("2 gift cards you bought will be emailed to sam@example.com on");
    const cards = await f.db.query.giftCards.findMany({ where: eq(schema.giftCards.sourceOrderId, order.id) });
    expect(cards.map((c) => [c.sentAt, c.scheduledFor?.toISOString()])).toEqual([[null, `${sendOn}T00:00:00.000Z`], [null, `${sendOn}T00:00:00.000Z`]]);

    // Not yet the day.
    expect(await sendScheduledGiftCards(f.gc, { now: new Date(`${day(9)}T23:00:00Z`) })).toEqual({ sent: 0 });
    // The day comes: both go out, each with its own working code.
    const now = new Date(`${sendOn}T06:00:00Z`);
    expect(await sendScheduledGiftCards(f.gc, { now })).toEqual({ sent: 2 });
    const mails = f.mailer.sent.filter((m) => m.to === "sam@example.com");
    expect(mails).toHaveLength(2);
    expect(mails[0]!.text).toContain("Ada sent you a gift card for Glow Lamps.");
    const codes = mails.flatMap((m) => codesIn(m.text));
    expect(new Set(codes).size).toBe(2);
    for (const code of codes) await expect(findGiftCard(f.db, f.shop, code)).resolves.toMatchObject({ balanceMinor: 5000 });
    // Running again sends nothing more.
    expect(await sendScheduledGiftCards(f.gc, { now })).toEqual({ sent: 0 });
  });

  it("a failed email is tried again next time; a card turned off or sent early by the store doesn't go out", async () => {
    const f = await setup();
    const { order } = await startCheckout(f.db, f.payments, f.shop, {
      email: "giver@example.com",
      address,
      lines: [{ variantId: f.fifty.id, quantity: 2 }],
      giftCardTo: { email: "sam@example.com", from: "Ada", sendOn: day(5) },
    });
    await f.pay(order);
    const [first, second] = await f.db.query.giftCards.findMany({ where: eq(schema.giftCards.sourceOrderId, order.id), orderBy: (g, { asc }) => asc(g.sourceIndex) });
    // The store sends the first one now; the second is turned off.
    await resendGiftCard(f.gc, f.shop, first!.id);
    await f.db.update(schema.giftCards).set({ disabledAt: new Date() }).where(eq(schema.giftCards.id, second!.id));
    const later = new Date(`${day(6)}T06:00:00Z`);
    expect(await sendScheduledGiftCards(f.gc, { now: later })).toEqual({ sent: 0 });
    expect(f.mailer.sent.filter((m) => m.to === "sam@example.com")).toHaveLength(1);

    // Turned back on, but the mail fails the first time.
    await f.db.update(schema.giftCards).set({ disabledAt: null }).where(eq(schema.giftCards.id, second!.id));
    const send = f.mailer.send.bind(f.mailer);
    f.mailer.send = async () => {
      throw new Error("down");
    };
    expect(await sendScheduledGiftCards(f.gc, { now: later })).toEqual({ sent: 0 });
    expect((await f.db.query.giftCards.findFirst({ where: eq(schema.giftCards.id, second!.id) }))!.sentAt).toBeNull();
    f.mailer.send = send;
    expect(await sendScheduledGiftCards(f.gc, { now: later })).toEqual({ sent: 1 });
  });

  it("checks the recipient's email and the day, and ignores it on an order with no gift cards", async () => {
    const f = await setup();
    const lines = [{ variantId: f.fifty.id, quantity: 1 }];
    const checkout = (giftCardTo: Record<string, string>) =>
      startCheckout(f.db, f.payments, f.shop, { email: "giver@example.com", address, lines, giftCardTo: giftCardTo as never });
    await expect(checkout({ email: "nope", from: "Ada" })).rejects.toThrow("Enter the email to send the gift card to.");
    await expect(checkout({ email: "sam@example.com", from: "" })).rejects.toThrow("Add who the gift card is from.");
    await expect(checkout({ email: "sam@example.com", from: "Ada", sendOn: "2026-02-30" })).rejects.toThrow("Pick the day to send the gift card.");
    await expect(checkout({ email: "sam@example.com", from: "Ada", sendOn: day(120) })).rejects.toThrow("up to 90 days ahead");
    // Today, or a day already gone, sends it now.
    const { order: today } = await checkout({ email: "sam@example.com", from: "Ada", sendOn: day(0) });
    expect(today.giftCardDelivery?.sendOn).toBeNull();

    const { order: lamp } = await startCheckout(f.db, f.payments, f.shop, {
      email: "giver@example.com",
      address,
      lines: [{ variantId: f.lamp.id, quantity: 1 }],
      giftCardTo: { email: "sam@example.com", from: "Ada" },
    });
    expect(lamp.giftCardDelivery).toBeNull();
  });
});
