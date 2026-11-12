import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, schema } from "@sf/db";
import { createShop, formatWait, listTickets, openTicket, replyToTicket, signUp, staffReply, SUPPORT_HOURS, supportRecord, supportWait, UserError } from "../src";

const H = 3_600_000;

describe("help from a person", () => {
  it("times the wait from the first message since our last answer", () => {
    const t0 = new Date("2026-11-12T08:00:00Z");
    const at = (h: number) => new Date(t0.getTime() + h * H);
    const msgs = [
      { author: "merchant", status: "sent", createdAt: at(0) },
      { author: "staff", status: "sent", createdAt: at(3) },
      { author: "merchant", status: "sent", createdAt: at(5) },
      { author: "merchant", status: "sent", createdAt: at(6) },
    ];
    expect(supportWait(msgs.slice(0, 2), t0, "free", at(4))).toBeNull();
    expect(supportWait(msgs, t0, "free", at(7))).toEqual({ waitingSince: at(5), dueAt: at(29), overdue: false });
    expect(supportWait(msgs, t0, "scale", at(10))).toEqual({ waitingSince: at(5), dueAt: at(9), overdue: true });
    // Opened by the assistant with no message of the merchant's own: the wait starts when it opened.
    expect(supportWait([{ author: "agent", status: "sent", createdAt: at(1) }], t0, "growth", at(2))!.dueAt).toEqual(at(12));
    expect(formatWait(40)).toBe("40 minutes");
    expect(formatWait(SUPPORT_HOURS.free * 60)).toBe("24 hours");
    expect(formatWait(72 * 60)).toBe("3 days");
  });

  it("lets a merchant write to our team, follow up, and shows how we kept the promise", async () => {
    const db = await createTestDb();
    const user = await signUp(db, { email: "owner@example.com", password: "correct horse" });
    const shop = await createShop(db, user.id, { name: "Glow Lamps", country: "US" });
    await expect(openTicket(db, shop.id, { subject: "Hi", body: "Help" })).rejects.toBeInstanceOf(UserError);
    const t = await openTicket(db, shop.id, { subject: "Payout missing", body: "It was sent Monday and isn't in my bank." });
    expect(t).toMatchObject({ kind: "ticket", status: "escalated" });

    const before = await listTickets(db, shop.id, new Date(Date.now() + H));
    expect(before.hours).toBe(24);
    expect(before.tickets[0]!.wait).toMatchObject({ overdue: false });
    expect(before.tickets[0]!.messages.map((m) => m.author)).toEqual(["merchant"]);
    expect((await listTickets(db, shop.id, new Date(Date.now() + 25 * H))).tickets[0]!.wait!.overdue).toBe(true);

    await staffReply(db, t.id, { body: "Your bank holds it a day. It lands tomorrow.", close: true, by: "staff@example.com" });
    const after = await listTickets(db, shop.id);
    expect(after.tickets[0]!.ticket.status).toBe("resolved");
    expect(after.tickets[0]!.wait).toBeNull();
    expect(await supportRecord(db)).toMatchObject({ answered: 1, onTime: 1 });

    // Following up reopens it, waiting on us again.
    await replyToTicket(db, shop.id, t.id, "Still not there.");
    const again = await listTickets(db, shop.id);
    expect(again.tickets[0]!.ticket.status).toBe("escalated");
    expect(again.tickets[0]!.wait).not.toBeNull();

    // Another store can't add to it, and paid plans get a faster promise.
    const other = await createShop(db, user.id, { name: "Other", country: "US" });
    await expect(replyToTicket(db, other.id, t.id, "Hello")).rejects.toThrow();
    await db.update(schema.shops).set({ plan: "scale" }).where(eq(schema.shops.id, shop.id));
    expect((await listTickets(db, shop.id)).hours).toBe(4);
  });
});
