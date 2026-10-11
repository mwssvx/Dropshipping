import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  campaignAudienceChoices, campaignAudienceSize, campaignAudienceText, createCampaign, DemoModel, duplicateCampaign, handlePaymentEvent, sendCampaignBatches,
  setMailingAddress, startCampaign, startCheckout, subscribeBuyer, unsubscribeBuyer, updateCampaign, updateCustomerNotes,
} from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const draft = { subject: "For you, {first_name}", body: "Hi {first_name},\n\nSomething new." };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  // The stand starts as a draft; put it on sale so it can be bought.
  await f.db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, f.products.stand.id));
  const [lamp] = await f.variants(f.products.lamp.id);
  const [stand] = await f.variants(f.products.stand.id);
  const ctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example" };
  const buy = async (email: string, variantId: string, acceptsMarketing = true) => {
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email, address, lines: [{ variantId, quantity: 1 }], acceptsMarketing });
    const ev = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(ev.body, ev.signature))!);
  };
  const tag = async (email: string, tags: string) => {
    const c = (await f.db.query.customers.findFirst({ where: and(eq(schema.customers.shopId, shop.id), eq(schema.customers.email, email)) }))!;
    await updateCustomerNotes(f.db, shop.id, c.id, { tags });
  };
  await setMailingAddress(f.db, shop.id, "Glow Lamps\n12 Elm St\nAustin TX 78701");
  return { ...f, store: shop, lamp: lamp!, stand: stand!, ctx, buy, tag };
}

describe("campaign audiences", () => {
  it("sends to subscribers with one tag", async () => {
    const f = await setup();
    await subscribeBuyer(f.db, f.store.id, "ada@example.com");
    await subscribeBuyer(f.db, f.store.id, "grace@example.com");
    await subscribeBuyer(f.db, f.store.id, "linus@example.com");
    await f.tag("ada@example.com", "VIP, wholesale lead");
    await f.tag("grace@example.com", "vip");
    await f.tag("linus@example.com", "newsletter");
    await unsubscribeBuyer(f.db, f.store.id, "grace@example.com");

    const choices = await campaignAudienceChoices(f.db, f.store.id);
    expect(choices.audiences.find((a) => a.value === "subscribers")!.size).toBe(2);
    expect(choices.audiences.find((a) => a.value === "tagged")!.size).toBeNull();
    // Only subscribers' tags, most used first.
    expect(choices.tags).toEqual([{ tag: "newsletter", count: 1 }, { tag: "vip", count: 1 }, { tag: "wholesale lead", count: 1 }]);

    await expect(createCampaign(f.db, f.store.id, null, { ...draft, audience: "tagged" })).rejects.toThrow("Pick the tag to send to.");
    const c = await createCampaign(f.db, f.store.id, null, { ...draft, audience: "tagged", audienceTag: "  VIP " });
    expect(c).toMatchObject({ audienceTag: "vip", audienceProductId: null });
    expect(await campaignAudienceText(f.db, c)).toBe('Subscribers tagged "vip"');
    expect(await campaignAudienceSize(f.db, f.store.id, c)).toBe(1);

    await startCampaign(f.ctx, await f.shop(), c.id);
    await sendCampaignBatches(f.ctx);
    expect(f.mailer.sent.filter((m) => m.subject.startsWith("For you")).map((m) => m.to)).toEqual(["ada@example.com"]);

    // A copy keeps the audience.
    const copy = await duplicateCampaign(f.db, f.store.id, null, c.id);
    expect(copy).toMatchObject({ audience: "tagged", audienceTag: "vip" });
  });

  it("sends to subscribers who bought one product, and keeps only the setting its audience needs", async () => {
    const f = await setup();
    await f.buy("ada@example.com", f.lamp.id);
    await f.buy("grace@example.com", f.stand.id);
    await f.buy("linus@example.com", f.lamp.id, false); // bought it, but said no to emails
    await subscribeBuyer(f.db, f.store.id, "margaret@example.com"); // never bought

    const choices = await campaignAudienceChoices(f.db, f.store.id);
    expect(choices.products.map((p) => p.id)).toContain(f.products.lamp.id);

    await expect(createCampaign(f.db, f.store.id, null, { ...draft, audience: "bought" })).rejects.toThrow("Pick the product its buyers bought.");
    await expect(createCampaign(f.db, f.store.id, null, { ...draft, audience: "bought", audienceProductId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(
      "Pick the product",
    );
    const c = await createCampaign(f.db, f.store.id, null, { ...draft, audience: "bought", audienceProductId: f.products.lamp.id, audienceTag: "vip" });
    expect(c).toMatchObject({ audienceProductId: f.products.lamp.id, audienceTag: null });
    expect(await campaignAudienceText(f.db, c)).toBe("Subscribers who bought Sunset Projection Lamp");
    expect(await campaignAudienceSize(f.db, f.store.id, c)).toBe(1);

    // Switching to everyone drops the product.
    const everyone = await updateCampaign(f.db, f.store.id, c.id, { ...draft, audience: "subscribers", audienceProductId: f.products.lamp.id });
    expect(everyone.audienceProductId).toBeNull();
    expect(await campaignAudienceSize(f.db, f.store.id, everyone)).toBe(3);

    const back = await updateCampaign(f.db, f.store.id, c.id, { ...draft, audience: "bought", audienceProductId: f.products.stand.id });
    await startCampaign(f.ctx, await f.shop(), back.id);
    await sendCampaignBatches(f.ctx);
    expect(f.mailer.sent.filter((m) => m.subject.startsWith("For you")).map((m) => m.to)).toEqual(["grace@example.com"]);
  });
});
