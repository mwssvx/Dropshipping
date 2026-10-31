import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  DemoModel,
  ExpoPushSender,
  fixProblemOrder,
  getPushSettings,
  LogPushSender,
  patchProduct,
  createProduct,
  createGiftCardProduct,
  registerDevice,
  saveMedia,
  getMedia,
  sendAllNotifications,
  sendShopNotifications,
  sendContactMessage,
  merchantReply,
  setPushSettings,
  staffReply,
  askAssistant,
  simulateHold,
  todaySummary,
  UserError,
} from "../src";
import { makeFixture } from "../evals/fixture";

const TOKEN = "ExponentPushToken[abc123]";

async function setup() {
  const f = await makeFixture(new DemoModel());
  const owner = (await f.db.query.users.findFirst())!;
  const push = new LogPushSender();
  return { ...f, owner, push, pctx: { db: f.db, push } };
}

describe("push notifications", () => {
  it("only accepts push tokens from the app", async () => {
    const f = await setup();
    await expect(registerDevice(f.db, f.owner.id, { token: "hello", platform: "ios" })).rejects.toThrow(UserError);
    await registerDevice(f.db, f.owner.id, { token: TOKEN, platform: "ios" });
    await registerDevice(f.db, f.owner.id, { token: TOKEN, platform: "ios" });
    expect(await f.db.query.pushDevices.findMany()).toHaveLength(1);
  });

  it("tells the merchant about a new order once, however often it runs", async () => {
    const f = await setup();
    await registerDevice(f.db, f.owner.id, { token: TOKEN, platform: "android" });
    const o = await f.waitingOrder();
    expect((await sendShopNotifications(f.pctx, (await f.shop()).id)).sent).toBe(1);
    expect(f.push.sent[0]).toMatchObject({ to: TOKEN, title: `New order #${o.number}`, url: `/orders/${o.id}`, sound: true });
    await sendShopNotifications(f.pctx, (await f.shop()).id);
    await sendAllNotifications(f.pctx);
    expect(f.push.sent).toHaveLength(1);
  });

  it("doesn't replay what happened before the phone signed in", async () => {
    const f = await setup();
    await f.waitingOrder();
    await new Promise((r) => setTimeout(r, 5));
    await registerDevice(f.db, f.owner.id, { token: TOKEN, platform: "ios" });
    await sendShopNotifications(f.pctx, (await f.shop()).id);
    expect(f.push.sent).toHaveLength(0);
  });

  it("covers problem orders, holds, proposals and staff replies, and respects what's turned off", async () => {
    const f = await setup();
    // The fixture's supplier clock runs a little behind real time.
    await registerDevice(f.db, f.owner.id, { token: TOKEN, platform: "ios" }, new Date(Date.now() - 3_600_000));
    await setPushSettings(f.db, f.owner.id, { off: ["new_order", "new_order_sound", "nonsense"] });
    expect((await getPushSettings(f.db, f.owner.id)).kinds.find((k) => k.kind === "new_order")?.on).toBe(false);

    const shop = await f.shop();
    const problem = await f.outOfStockOrder();
    await fixProblemOrder(f.ctx, shop, problem.id);
    await simulateHold(f.db, shop.id);
    await askAssistant(f.ctx, shop, "My payout is on hold, can a person help?");
    const ticket = (await f.db.query.conversations.findFirst({ where: eq(schema.conversations.kind, "ticket") }))!;
    await staffReply(f.db, ticket.id, { body: "We released the hold.", close: true, by: "staff@example.com" });

    await sendShopNotifications(f.pctx, shop.id);
    const titles = f.push.sent.map((m) => m.title);
    expect(titles).toContain(`Order #${problem.number} needs you`);
    expect(titles).toContain("Payouts are paused");
    expect(titles).toContain("Waiting for your OK");
    expect(titles).toContain("Our support team replied");
    expect(titles.some((t) => t.startsWith("New order"))).toBe(false);
    const off = await f.db.query.pushMessages.findMany({ where: eq(schema.pushMessages.status, "off") });
    expect(off.map((m) => m.kind)).toEqual(["new_order"]);
  });

  it("tells the merchant about buyer questions that wait for them, and not ones already answered", async () => {
    const f = await setup();
    await registerDevice(f.db, f.owner.id, { token: TOKEN, platform: "ios" }, new Date(Date.now() - 3_600_000));
    const shop = await f.shop();
    const first = await sendContactMessage(f.db, shop, { name: "Grace Hopper", email: "grace@example.com", message: "Do you ship to Canada?" });
    const second = await sendContactMessage(f.db, shop, { name: "Alan Turing", email: "alan@example.com", message: "Can I change my size?" });
    await merchantReply(f.ctx, shop.id, second!.conversationId, "Yes, reply with the size you'd like.");
    await sendShopNotifications(f.pctx, shop.id);
    const asks = f.push.sent.filter((m) => m.url?.startsWith("/inbox/"));
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ title: "Message from Grace Hopper", body: "Do you ship to Canada?", url: `/inbox/${first!.conversationId}` });
    expect((await todaySummary(f.db, shop)).attention.find((a) => a.kind === "inbox")).toMatchObject({ body: "Open the inbox to answer them.", url: "/inbox" });
  });

  it("tells the merchant about a return asked for and a review waiting, to people who handle them", async () => {
    const f = await setup();
    await registerDevice(f.db, f.owner.id, { token: TOKEN, platform: "ios" }, new Date(Date.now() - 3_600_000));
    const shop = await f.shop();
    const o = await f.waitingOrder();
    await f.db.insert(schema.returnRequests).values({ shopId: shop.id, orderId: o.id, reason: "damaged", note: "The glass is cracked.", items: [], suggestedMinor: 0 });
    await f.db.insert(schema.reviews).values({ shopId: shop.id, productId: f.products.stand.id, name: "Grace H.", rating: 3, body: "Smaller than I thought.", status: "pending" });
    // A review already published needs nothing.
    await f.db.insert(schema.reviews).values({ shopId: shop.id, productId: f.products.stand.id, name: "Ada L.", rating: 5, body: "Lovely.", status: "published" });
    await sendShopNotifications(f.pctx, shop.id);
    const returns = f.push.sent.filter((m) => m.url === "/returns");
    expect(returns).toEqual([expect.objectContaining({ title: `A return was asked for on order #${o.number}`, body: "It arrived damaged: The glass is cracked." })]);
    const reviews = f.push.sent.filter((m) => m.url === "/reviews");
    expect(reviews).toEqual([expect.objectContaining({ title: "New 3-star review from Grace H.", body: "Smaller than I thought." })]);
    // Each once, however often the sweep runs; and a person can turn either off.
    await sendShopNotifications(f.pctx, shop.id);
    expect(f.push.sent.filter((m) => m.url === "/returns" || m.url === "/reviews")).toHaveLength(2);
    expect((await getPushSettings(f.db, f.owner.id)).kinds.map((k) => k.label)).toEqual(expect.arrayContaining(["Returns buyers ask for", "Reviews waiting for your OK"]));
  });

  it("tells the merchant about a shopper's question on a product, once", async () => {
    const f = await setup();
    await registerDevice(f.db, f.owner.id, { token: TOKEN, platform: "ios" }, new Date(Date.now() - 3_600_000));
    const shop = await f.shop();
    await f.db.insert(schema.productQuestions).values({ shopId: shop.id, productId: f.products.stand.id, name: "Grace", email: "grace@example.com", body: "Does it fold flat for travel?" });
    await sendShopNotifications(f.pctx, shop.id);
    await sendShopNotifications(f.pctx, shop.id);
    const sent = f.push.sent.filter((m) => m.url === "/questions");
    expect(sent).toEqual([expect.objectContaining({ title: `Grace asked about ${f.products.stand.title}`, body: "Does it fold flat for travel?" })]);
    expect((await getPushSettings(f.db, f.owner.id)).kinds.map((k) => k.label)).toContain("Questions shoppers ask about products");
  });

  it("tells the merchant about a wholesale application, once, and not about buyers they added", async () => {
    const f = await setup();
    await registerDevice(f.db, f.owner.id, { token: TOKEN, platform: "ios" }, new Date(Date.now() - 3_600_000));
    const shop = await f.shop();
    await f.db.insert(schema.customers).values({ shopId: shop.id, email: "buyer@corner.example", wholesaleStatus: "pending", wholesaleCompany: "Corner Shop", wholesaleMessage: "Two gift shops in Austin.", wholesaleRequestedAt: new Date() });
    await f.db.insert(schema.customers).values({ shopId: shop.id, email: "known@wholesale.example", wholesaleStatus: "approved", wholesaleCompany: "Known Ltd", wholesaleRequestedAt: new Date() });
    await sendShopNotifications(f.pctx, shop.id);
    await sendShopNotifications(f.pctx, shop.id);
    const sent = f.push.sent.filter((m) => m.url === "/wholesale");
    expect(sent).toEqual([expect.objectContaining({ title: "Corner Shop wants wholesale prices", body: "Two gift shops in Austin." })]);
    expect((await getPushSettings(f.db, f.owner.id)).kinds.map((k) => k.label)).toContain("Wholesale applications");
  });

  it("forgets phones the push service says are gone", async () => {
    const f = await setup();
    await registerDevice(f.db, f.owner.id, { token: TOKEN, platform: "ios" });
    await f.waitingOrder();
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ data: [{ status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }] }), { status: 200 })) as typeof fetch;
    await sendShopNotifications({ db: f.db, push: new ExpoPushSender(undefined, fakeFetch) }, (await f.shop()).id);
    expect(await f.db.query.pushDevices.findMany()).toHaveLength(0);
    expect((await f.db.query.pushMessages.findFirst())?.status).toBe("failed");
  });
});

describe("today and quick edits", () => {
  it("sums today's sales and lists what needs the merchant", async () => {
    const f = await setup();
    const shop = await f.shop();
    const a = await f.waitingOrder();
    await f.outOfStockOrder();
    await simulateHold(f.db, shop.id);
    const t = await todaySummary(f.db, shop);
    expect(t.ordersToday).toBe(2);
    expect(t.salesTodayMinor).toBeGreaterThan(a.totalMinor);
    expect(t.attention.map((x) => x.kind)).toEqual(["hold", "problems"]);
  });

  it("changes price, stock and status, and nothing else", async () => {
    const f = await setup();
    const shop = await f.shop();
    const [v] = await f.variants(f.products.stand.id);
    const p = await patchProduct(f.db, shop.id, f.products.stand.id, { status: "active", variants: [{ id: v!.id, priceMinor: 2599, stock: 12 }] });
    expect(p.status).toBe("active");
    expect(p.variants[0]).toMatchObject({ priceMinor: 2599, stock: 12, costMinor: v!.costMinor });
    expect(p.title).toBe(f.products.stand.title);
    await expect(patchProduct(f.db, shop.id, f.products.stand.id, { variants: [{ id: v!.id, priceMinor: -1 }] })).rejects.toThrow(UserError);
  });

  it("sets a product's tags from the phone, and leaves them alone when none are sent", async () => {
    const f = await setup();
    const shop = await f.shop();
    const tagged = await patchProduct(f.db, shop.id, f.products.stand.id, { tags: "Gift Idea, summer, summer" });
    expect(tagged.tags).toEqual(["gift idea", "summer"]);
    const kept = await patchProduct(f.db, shop.id, f.products.stand.id, { status: "active" });
    expect(kept.tags).toEqual(["gift idea", "summer"]);
    const cleared = await patchProduct(f.db, shop.id, f.products.stand.id, { tags: [] });
    expect(cleared.tags).toEqual([]);
    await expect(patchProduct(f.db, shop.id, f.products.stand.id, { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).rejects.toThrow(UserError);
  });

  it("sets the packed weight of anything that ships, and the cost of the store's own stock", async () => {
    const f = await setup();
    const shop = await f.shop();
    const [stand] = await f.variants(f.products.stand.id);
    // A supplier product: its weight can be set, its cost stays the supplier's.
    const p = await patchProduct(f.db, shop.id, f.products.stand.id, { variants: [{ id: stand!.id, weightGrams: 180 }] });
    expect(p.variants[0]).toMatchObject({ weightGrams: 180, costMinor: stand!.costMinor });
    await expect(patchProduct(f.db, shop.id, f.products.stand.id, { variants: [{ id: stand!.id, costMinor: 100 }] })).rejects.toThrow("keep the supplier's cost");
    await expect(patchProduct(f.db, shop.id, f.products.stand.id, { variants: [{ id: stand!.id, weightGrams: 0 }] })).rejects.toThrow("more than 0");
    // The store's own candle: both, and either can be cleared.
    const own = await createProduct(f.db, shop.id, { title: "Beeswax Candle", variants: [{ priceMinor: 1200, stock: 5 }] });
    const [candle] = await f.variants(own.id);
    const set = await patchProduct(f.db, shop.id, own.id, { variants: [{ id: candle!.id, weightGrams: 300, costMinor: 450 }] });
    expect(set.variants[0]).toMatchObject({ weightGrams: 300, costMinor: 450, priceMinor: 1200, stock: 5 });
    const cleared = await patchProduct(f.db, shop.id, own.id, { variants: [{ id: candle!.id, weightGrams: null, costMinor: null }] });
    expect(cleared.variants[0]).toMatchObject({ weightGrams: null, costMinor: null });
    // A gift card neither ships nor costs anything.
    const card = await createGiftCardProduct(f.db, shop, [2500]);
    const [gift] = await f.variants(card.id);
    await expect(patchProduct(f.db, shop.id, card.id, { variants: [{ id: gift!.id, weightGrams: 10 }] })).rejects.toThrow("don't ship");
    await expect(patchProduct(f.db, shop.id, card.id, { variants: [{ id: gift!.id, costMinor: 10 }] })).rejects.toThrow("Gift cards have no cost");
  });

  it("sets a crossed-out price above the price, and drops it once the price passes it", async () => {
    const f = await setup();
    const shop = await f.shop();
    const own = await createProduct(f.db, shop.id, { title: "Beeswax Candle", variants: [{ priceMinor: 1200, stock: 5 }] });
    const [candle] = await f.variants(own.id);
    const sale = await patchProduct(f.db, shop.id, own.id, { variants: [{ id: candle!.id, priceMinor: 900, compareAtMinor: 1200 }] });
    expect(sale.variants[0]).toMatchObject({ priceMinor: 900, compareAtMinor: 1200 });
    // Typed at or below the price, it's refused rather than shown as a fake sale.
    await expect(patchProduct(f.db, shop.id, own.id, { variants: [{ id: candle!.id, compareAtMinor: 900 }] })).rejects.toThrow("higher than the price");
    // A stock change leaves it be; a price rise past it clears it.
    expect((await patchProduct(f.db, shop.id, own.id, { variants: [{ id: candle!.id, stock: 4 }] })).variants[0]!.compareAtMinor).toBe(1200);
    const raised = await patchProduct(f.db, shop.id, own.id, { variants: [{ id: candle!.id, priceMinor: 1300 }] });
    expect(raised.variants[0]).toMatchObject({ priceMinor: 1300, compareAtMinor: null });
    // And it can be set and cleared on its own.
    expect((await patchProduct(f.db, shop.id, own.id, { variants: [{ id: candle!.id, compareAtMinor: 1500 }] })).variants[0]!.compareAtMinor).toBe(1500);
    expect((await patchProduct(f.db, shop.id, own.id, { variants: [{ id: candle!.id, compareAtMinor: null }] })).variants[0]!.compareAtMinor).toBe(null);
  });

  it("keeps only real photos up to 5 MB", async () => {
    const f = await setup();
    const shop = await f.shop();
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
    const { id, contentType } = await saveMedia(f.db, shop.id, jpeg);
    expect(contentType).toBe("image/jpeg");
    expect((await getMedia(f.db, id))?.bytes).toBe(104);
    await expect(saveMedia(f.db, shop.id, Buffer.from("<svg onload=alert(1)>"))).rejects.toThrow("JPG, PNG or WebP");
    await expect(saveMedia(f.db, shop.id, Buffer.concat([jpeg, Buffer.alloc(5 * 1024 * 1024)]))).rejects.toThrow("5 MB");
  });
});
