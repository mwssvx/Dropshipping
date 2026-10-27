import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  canPayByTransfer, chooseBankTransfer, countWaitingTransfers, DemoModel, lapseBankTransfers, abandonedCheckouts, markTransferPaid, onOrderPaid,
  sendAbandonedCartEmails, setBankTransfer, setGrowthSettings, startCheckout, transferDueBy,
} from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const f = await makeFixture(new DemoModel());
  const [lamp] = await f.variants(f.products.lamp.id);
  const checkout = async () => (await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines: [{ variantId: lamp!.id, quantity: 1 }] })).order;
  const reload = async (id: string) => (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, id) }))!;
  return { ...f, checkout, reload };
}

describe("bank transfers", () => {
  it("are for paid plans, with real account details", async () => {
    const f = await setup();
    const shop = await f.shop();
    await expect(setBankTransfer(f.db, shop, { details: "Acme Ltd, IBAN DE89 3704 0044 0532 0130 00", days: 7 })).rejects.toThrow("paid plans");
    await f.db.update(schema.shops).set({ plan: "growth" }).where(eq(schema.shops.id, shop.id));
    const paid = await f.shop();
    await expect(setBankTransfer(f.db, paid, { details: "Acme", days: 7 })).rejects.toThrow("account to pay into");
    await expect(setBankTransfer(f.db, paid, { details: "Acme Ltd, IBAN DE89 3704 0044 0532 0130 00", days: 1 })).rejects.toThrow("2 to 30 days");
    expect(await setBankTransfer(f.db, paid, { details: "  Acme Ltd\r\nIBAN DE89 3704 0044 0532 0130 00  ", days: 5 })).toEqual({ details: "Acme Ltd\nIBAN DE89 3704 0044 0532 0130 00", days: 5 });
    const order = await f.checkout();
    expect(canPayByTransfer(await f.shop(), order)).toBe(true);
    expect(canPayByTransfer({ ...(await f.shop()), plan: "free" }, order)).toBe(false);
    expect(canPayByTransfer(await f.shop(), { ...order, paymentStatus: "paid" })).toBe(false);
    expect(await setBankTransfer(f.db, paid, null)).toBeNull();
    expect(canPayByTransfer(await f.shop(), order)).toBe(false);
  });

  it("waits for the merchant to see the money, then it's an ordinary paid order", async () => {
    const f = await setup();
    const shop = await f.shop();
    await f.db.update(schema.shops).set({ plan: "growth" }).where(eq(schema.shops.id, shop.id));
    await setBankTransfer(f.db, await f.shop(), { details: "Acme Ltd\nIBAN DE89 3704 0044 0532 0130 00", days: 5 });
    await setGrowthSettings(f.db, shop.id, { abandonedCartEmails: true });
    const order = await f.checkout();

    const chosen = await chooseBankTransfer(f.ctx, shop.id, order.id);
    expect(chosen).toMatchObject({ manualPayment: "bank_transfer", paymentStatus: "pending" });
    expect(transferDueBy(await f.shop(), chosen)!.getTime()).toBe(chosen.manualPaymentAt!.getTime() + 5 * DAY);
    const mail = f.mailer.sent.find((m) => m.subject === `How to pay for your order #${order.number}`)!;
    expect(mail.text).toContain("IBAN DE89 3704 0044 0532 0130 00");
    expect(mail.text).toContain(`Reference: Order ${order.number}`);
    // Choosing again changes nothing and sends nothing.
    await chooseBankTransfer(f.ctx, shop.id, order.id);
    expect(f.mailer.sent.filter((m) => m.subject.startsWith("How to pay")).length).toBe(1);
    expect(await countWaitingTransfers(f.db, shop.id)).toBe(1);

    // It isn't an abandoned checkout.
    await sendAbandonedCartEmails(f.ctx, new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(f.mailer.sent.some((m) => m.to === "ada@example.com" && /left|cart/i.test(m.subject))).toBe(false);
    expect((await abandonedCheckouts(f.db, shop.id, { now: new Date(Date.now() + 2 * 60 * 60 * 1000) })).checkouts).toHaveLength(0);

    expect(await markTransferPaid(f.db, shop.id, order.id)).toBe(true);
    expect(await markTransferPaid(f.db, shop.id, order.id)).toBe(false);
    await onOrderPaid(f.ctx, order.id);
    const paid = await f.reload(order.id);
    expect(paid.paymentStatus).toBe("paid");
    expect(paid.paidAt).not.toBeNull();
    expect(f.mailer.sent.some((m) => m.subject === `Order #${order.number} confirmed`)).toBe(true);
    expect(await countWaitingTransfers(f.db, shop.id)).toBe(0);
    await expect(markTransferPaid(f.db, shop.id, (await f.checkout()).id)).rejects.toThrow("isn't waiting for a bank transfer");
  });

  it("lapses when nothing arrives in time, and a late transfer still counts", async () => {
    const f = await setup();
    const shop = await f.shop();
    await f.db.update(schema.shops).set({ plan: "starter" }).where(eq(schema.shops.id, shop.id));
    await setBankTransfer(f.db, await f.shop(), { details: "Acme Ltd, sort code 12-34-56, account 12345678", days: 3 });
    const order = await f.checkout();
    await chooseBankTransfer(f.ctx, shop.id, order.id);

    expect(await lapseBankTransfers(f.ctx, new Date(Date.now() + 2.5 * DAY))).toEqual({ lapsed: 0 });
    expect(await lapseBankTransfers(f.ctx, new Date(Date.now() + 3.1 * DAY))).toEqual({ lapsed: 1 });
    expect((await f.reload(order.id)).paymentStatus).toBe("failed");
    const mail = f.mailer.sent.find((m) => m.subject === `We didn't get your payment for order #${order.number}`)!;
    expect(mail.text).toContain("pay by card now");
    expect(await lapseBankTransfers(f.ctx, new Date(Date.now() + 10 * DAY))).toEqual({ lapsed: 0 });

    expect(await markTransferPaid(f.db, shop.id, order.id)).toBe(true);
    expect((await f.reload(order.id)).paymentStatus).toBe("paid");
  });
});
