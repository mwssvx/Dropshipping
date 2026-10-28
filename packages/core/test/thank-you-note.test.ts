import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createShop, DemoModel, exportStore, importStore, setThankYouNote, signUp, THANK_YOU_NOTE_MAX } from "../src";
import { makeFixture } from "../evals/fixture";

describe("thank-you note", () => {
  it("goes in the order confirmation once set, tidied, and can be removed", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const before = await f.waitingOrder();
    expect(f.mailer.sent.find((m) => m.subject === `Order #${before.number} confirmed`)!.text).not.toContain("Instagram");

    expect(await setThankYouNote(f.db, shop.id, "  Follow us on Instagram @glow.\r\n\r\n\r\n\r\nNew colours every month.  ")).toBe(
      "Follow us on Instagram @glow.\n\nNew colours every month.",
    );
    await expect(setThankYouNote(f.db, shop.id, "x".repeat(THANK_YOU_NOTE_MAX + 1))).rejects.toThrow("under 500 characters");
    const order = await f.waitingOrder();
    const receipt = f.mailer.sent.find((m) => m.subject === `Order #${order.number} confirmed`)!;
    expect(receipt.text).toContain("\n\nFollow us on Instagram @glow.\n\nNew colours every month.\n");

    // Store files carry it.
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.store.thank_you_note).toBe("Follow us on Instagram @glow.\n\nNew colours every month.");
    const owner = await signUp(f.db, { email: "copy-owner@example.com", password: "correct horse battery" });
    const copy = await createShop(f.db, owner.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    expect((await f.db.query.shops.findFirst({ where: eq(schema.shops.id, copy.id) }))!.thankYouNote).toBe(file.store.thank_you_note);

    expect(await setThankYouNote(f.db, shop.id, "   ")).toBeNull();
    const after = await f.waitingOrder();
    expect(f.mailer.sent.find((m) => m.subject === `Order #${after.number} confirmed`)!.text).not.toContain("Instagram");
  });
});
