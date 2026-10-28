import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { CHAT_BUTTON_QUIET, chatLinks, createShop, DemoModel, exportStore, importStore, setChatButtons, signUp, telegramUsername, whatsappNumber } from "../src";
import { makeFixture } from "../evals/fixture";

describe("chat buttons", () => {
  it("cleans up the WhatsApp number and Telegram username, and refuses ones that can't work", () => {
    expect(whatsappNumber("+44 7700 900123")).toBe("447700900123");
    expect(whatsappNumber("0044 (7700) 900-123")).toBe("447700900123");
    expect(whatsappNumber("  ")).toBeNull();
    expect(() => whatsappNumber("07700 900123")).toThrow("with its country code");
    expect(() => whatsappNumber("+1 555")).toThrow("with its country code");
    expect(telegramUsername("@glowlamps")).toBe("glowlamps");
    expect(telegramUsername("https://t.me/glow_lamps/")).toBe("glow_lamps");
    expect(() => telegramUsername("@ab")).toThrow("5 to 32 letters");
    expect(() => telegramUsername("glow lamps")).toThrow("Telegram username");
  });

  it("makes the chat links, saves and clears the setting, and store files carry it", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const saved = await setChatButtons(f.db, shop.id, { whatsapp: "+44 7700 900123", telegram: "" });
    expect(saved).toEqual({ whatsapp: "447700900123", telegram: null });
    expect(chatLinks(saved, "Hi! A question about this: https://glow.example/products/lamp")).toEqual([
      { kind: "whatsapp", href: "https://wa.me/447700900123?text=Hi!%20A%20question%20about%20this%3A%20https%3A%2F%2Fglow.example%2Fproducts%2Flamp" },
    ]);
    const both = await setChatButtons(f.db, shop.id, { whatsapp: "+44 7700 900123", telegram: "@glowlamps" });
    expect(chatLinks(both, "Hi").map((l) => l.href)).toEqual(["https://wa.me/447700900123?text=Hi", "https://t.me/glowlamps"]);
    expect(CHAT_BUTTON_QUIET.test("/checkout")).toBe(true);
    expect(CHAT_BUTTON_QUIET.test("/de/pay/123")).toBe(true);
    expect(CHAT_BUTTON_QUIET.test("/products/lamp")).toBe(false);

    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.store.chat_buttons).toEqual({ whatsapp: "447700900123", telegram: "glowlamps" });
    const owner = await signUp(f.db, { email: "chat-copy@example.com", password: "correct horse battery" });
    const copy = await createShop(f.db, owner.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    expect((await f.db.query.shops.findFirst({ where: eq(schema.shops.id, copy.id) }))!.chatButtons).toEqual(both);

    expect(await setChatButtons(f.db, shop.id, { whatsapp: "", telegram: " " })).toBeNull();
    expect(chatLinks(null, "Hi")).toEqual([]);
  });
});
