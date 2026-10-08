import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  audienceSizes, campaignAllowance, campaignStats, cancelScheduledCampaign, createCampaign, DemoModel, deleteCampaign, getBuyer, handlePaymentEvent,
  listCampaigns, recordCampaignClick, sendCampaignBatches, sendTestCampaign, setMailingAddress, startCampaign, startCheckout, subscribeBuyer,
  unsubscribeBuyer, unsubscribeByToken, updateCampaign,
} from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const [lamp] = await f.variants(f.products.lamp.id);
  let clock = Date.now();
  const ctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example", now: () => new Date(clock) };
  const buy = async (email: string, opts: { acceptsMarketing?: boolean; campaignId?: string | null; name?: string } = {}) => {
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email, address: { ...address, name: opts.name ?? address.name }, lines: [{ variantId: lamp!.id, quantity: 1 }], ...opts });
    const ev = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(ev.body, ev.signature))!);
    return order;
  };
  const campaignMail = () => f.mailer.sent.filter((m) => m.subject.startsWith("Autumn"));
  return { ...f, ctx, buy, campaignMail, advance: (ms: number) => (clock += ms) };
}

const draft = { subject: "Autumn sale, {first_name}", body: "Hi {first_name},\n\nEverything is 20% off this week with AUTUMN20.", buttonLabel: "Shop the sale", buttonPath: "/collections/all" };

describe("email campaigns", () => {
  it("sends only to buyers who said yes, with their name, a tracked button and an unsubscribe link", async () => {
    const f = await setup();
    await f.buy("ada@example.com", { acceptsMarketing: true });
    await f.buy("grace@example.com", { name: "Grace Hopper" }); // didn't tick the box
    await subscribeBuyer(f.db, (await f.shop()).id, "linus@example.com"); // signed up, never bought
    const shop = await f.shop();
    expect(await audienceSizes(f.db, shop.id)).toEqual({ subscribers: 2, customers: 1, not_bought: 1, lapsed: 0 });

    const c = await createCampaign(f.db, shop.id, null, draft);
    await expect(startCampaign(f.ctx, shop, c.id)).rejects.toThrow("mailing address");
    await setMailingAddress(f.db, shop.id, "Glow Lamps\n12 Elm St\nAustin TX 78701");

    // A test copy first.
    await sendTestCampaign(f.ctx, await f.shop(), c.id, "owner@example.com");
    expect(f.mailer.sent.at(-1)).toMatchObject({ to: "owner@example.com", subject: "[Test] Autumn sale, there" });

    const started = await startCampaign(f.ctx, await f.shop(), c.id);
    expect(started).toMatchObject({ status: "sending", recipients: 2 });
    await expect(updateCampaign(f.db, shop.id, c.id, draft)).rejects.toThrow("already gone out");
    expect(await sendCampaignBatches(f.ctx)).toEqual({ sent: 2, skipped: 0 });

    const mails = f.campaignMail();
    expect(mails.map((m) => m.to).sort()).toEqual(["ada@example.com", "linus@example.com"]);
    const ada = mails.find((m) => m.to === "ada@example.com")!;
    expect(ada.subject).toBe("Autumn sale, Ada");
    expect(ada.text).toContain("Hi Ada,");
    expect(ada.text).toMatch(/Shop the sale: https:\/\/glow\.example\/r\/[0-9a-f-]{36}/);
    expect(ada.text).toContain("Glow Lamps · Glow Lamps, 12 Elm St, Austin TX 78701");
    expect(ada.text).toMatch(/Unsubscribe: https:\/\/glow\.example\/unsubscribe\/[0-9a-f]{64}/);
    expect(ada.headers).toMatchObject({ "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(mails.find((m) => m.to === "linus@example.com")!.text).toContain("Hi there,");
    const [listed] = await listCampaigns(f.db, shop.id);
    expect(listed).toMatchObject({ status: "sent", stats: { sent: 2 } });
    await expect(deleteCampaign(f.db, shop.id, c.id)).rejects.toThrow("stay");
  });

  it("counts clicks and credits orders placed after a click", async () => {
    const f = await setup();
    await f.buy("ada@example.com", { acceptsMarketing: true });
    const shop = await f.shop();
    await setMailingAddress(f.db, shop.id, "12 Elm St, Austin TX");
    const c = await createCampaign(f.db, shop.id, null, draft);
    await startCampaign(f.ctx, await f.shop(), c.id);
    await sendCampaignBatches(f.ctx);
    const sendId = f.campaignMail()[0]!.text.match(/\/r\/([0-9a-f-]{36})/)![1]!;

    expect(await recordCampaignClick(f.db, shop.id, sendId)).toEqual({ campaignId: c.id, path: "/collections/all" });
    await recordCampaignClick(f.db, shop.id, sendId); // a second click isn't a second person
    expect(await recordCampaignClick(f.db, "00000000-0000-0000-0000-000000000000", sendId)).toBeNull();
    const order = await f.buy("ada@example.com", { campaignId: c.id });
    // Another store's campaign id is ignored.
    const other = await f.buy("ada@example.com", { campaignId: "00000000-0000-0000-0000-000000000000" });
    expect(other.campaignId).toBeNull();
    expect(await campaignStats(f.db, c.id)).toMatchObject({ sent: 1, clicks: 1, orders: 1, salesMinor: order.totalMinor });
  });

  it("skips people who unsubscribe before their email goes out, and the link works without signing in", async () => {
    const f = await setup();
    const shop = await f.shop();
    await setMailingAddress(f.db, shop.id, "12 Elm St, Austin TX");
    for (const e of ["a@example.com", "b@example.com", "c@example.com"]) await subscribeBuyer(f.db, shop.id, e);
    const c = await createCampaign(f.db, shop.id, null, draft);
    await startCampaign(f.ctx, await f.shop(), c.id);
    await unsubscribeBuyer(f.db, shop.id, "b@example.com");
    expect(await sendCampaignBatches(f.ctx, { limit: 2 })).toEqual({ sent: 1, skipped: 1 });
    expect((await listCampaigns(f.db, shop.id))[0]!.status).toBe("sending");
    expect(await sendCampaignBatches(f.ctx)).toEqual({ sent: 1, skipped: 0 });
    expect((await listCampaigns(f.db, shop.id))[0]!.status).toBe("sent");

    const token = f.campaignMail().find((m) => m.to === "c@example.com")!.text.match(/unsubscribe\/([0-9a-f]+)/)![1]!;
    expect(await unsubscribeByToken(f.db, "00000000-0000-0000-0000-000000000000", token)).toBeNull();
    expect(await unsubscribeByToken(f.db, shop.id, token)).toEqual({ email: "c@example.com" });
    expect(await audienceSizes(f.db, shop.id)).toMatchObject({ subscribers: 1 });
    // Ticking the box again later is a fresh yes.
    await subscribeBuyer(f.db, shop.id, "c@example.com");
    expect(await audienceSizes(f.db, shop.id)).toMatchObject({ subscribers: 2 });
  });

  it("schedules for later, can be cancelled, and keeps to the monthly allowance", async () => {
    const f = await setup();
    const shop = await f.shop();
    await setMailingAddress(f.db, shop.id, "12 Elm St, Austin TX");
    await subscribeBuyer(f.db, shop.id, "a@example.com");
    const c = await createCampaign(f.db, shop.id, null, draft);
    await expect(startCampaign(f.ctx, await f.shop(), c.id, { scheduledFor: new Date(Date.now() - 3_600_000) })).rejects.toThrow("future");
    await startCampaign(f.ctx, await f.shop(), c.id, { scheduledFor: new Date(Date.now() + 3_600_000) });
    expect(await sendCampaignBatches(f.ctx)).toEqual({ sent: 0, skipped: 0 });
    await cancelScheduledCampaign(f.db, shop.id, c.id);
    expect((await listCampaigns(f.db, shop.id))[0]).toMatchObject({ status: "draft", recipients: 0 });

    await startCampaign(f.ctx, await f.shop(), c.id, { scheduledFor: new Date(Date.now() + 3_600_000) });
    f.advance(3_600_001);
    expect(await sendCampaignBatches(f.ctx)).toEqual({ sent: 1, skipped: 0 });
    expect(await campaignAllowance(f.db, shop.id)).toMatchObject({ used: 1, left: 9_999 });

    // Nobody to send to, and a paused store can't send.
    const empty = await createCampaign(f.db, shop.id, null, { ...draft, audience: "customers" });
    await expect(startCampaign(f.ctx, await f.shop(), empty.id)).rejects.toThrow("Nobody");
    await f.setShop({ status: "paused", statusReason: "Too many chargebacks" });
    const later = await createCampaign(f.db, shop.id, null, draft);
    await expect(startCampaign(f.ctx, await f.shop(), later.id)).rejects.toThrow("paused");
  });

  it("checks what the merchant writes", async () => {
    const f = await setup();
    const shop = await f.shop();
    await expect(createCampaign(f.db, shop.id, null, { ...draft, subject: " " })).rejects.toThrow("subject");
    await expect(createCampaign(f.db, shop.id, null, { ...draft, buttonPath: "//evil.example" })).rejects.toThrow("page on your store");
    await expect(createCampaign(f.db, shop.id, null, { ...draft, buttonPath: "https://evil.example" })).rejects.toThrow("page on your store");
    expect((await createCampaign(f.db, shop.id, null, { ...draft, buttonPath: "products/lamp" })).buttonPath).toBe("/products/lamp");
  });

  it("remembers the yes on the buyer's account", async () => {
    const f = await setup();
    await f.buy("ada@example.com", { acceptsMarketing: true });
    await f.buy("ada@example.com", { acceptsMarketing: false });
    const row = await f.db.query.customers.findFirst({ where: eq(schema.customers.email, "ada@example.com") });
    expect(row).toMatchObject({ acceptsMarketing: true, marketingConsentAt: expect.any(Date) });
    expect(await getBuyer(f.db, (await f.shop()).id, undefined)).toBeNull();
  });
});
