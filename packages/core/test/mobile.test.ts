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
