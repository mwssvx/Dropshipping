import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, repeatBuyers } from "../src";
import { makeFixture } from "../evals/fixture";

const now = new Date("2026-10-28T12:00:00Z");

describe("buyers who come back", () => {
  it("counts first-time buyers by month and who ordered again within 90 days", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    expect((await repeatBuyers(f.db, shopId, { now })).share).toBeNull();

    const bought = async (email: string, iso: string, source?: "replacement") => {
      const o = await f.waitingOrder();
      await f.db.update(schema.orders).set({ email, paidAt: new Date(iso), ...(source ? { source } : {}) }).where(eq(schema.orders.id, o.id));
    };
    await bought("ada@example.com", "2026-05-10T10:00:00Z");
    await bought("ada@example.com", "2026-06-01T10:00:00Z");
    await bought("bea@example.com", "2026-05-20T10:00:00Z");
    await bought("bea@example.com", "2026-09-01T10:00:00Z");
    // The same buyer whatever the case of their email.
    await bought("Cleo@example.com", "2026-06-05T10:00:00Z");
    await bought("cleo@example.com", "2026-06-25T10:00:00Z");
    // First bought before the months shown, so not a new buyer in May.
    await bought("dot@example.com", "2026-04-01T10:00:00Z");
    await bought("dot@example.com", "2026-05-15T10:00:00Z");
    await bought("eve@example.com", "2026-10-01T10:00:00Z");
    // A free replacement isn't a second order.
    await bought("eve@example.com", "2026-10-05T10:00:00Z", "replacement");

    const r = await repeatBuyers(f.db, shopId, { now });
    expect(r.months).toEqual([
      { month: "2026-05", buyers: 2, cameBack: 1, share: 0.5, complete: true },
      { month: "2026-06", buyers: 1, cameBack: 1, share: 1, complete: true },
      // July's buyers have until the end of October.
      { month: "2026-07", buyers: 0, cameBack: 0, share: null, complete: false },
      { month: "2026-08", buyers: 0, cameBack: 0, share: null, complete: false },
      { month: "2026-09", buyers: 0, cameBack: 0, share: null, complete: false },
      { month: "2026-10", buyers: 1, cameBack: 0, share: 0, complete: false },
    ]);
    expect(r.share).toBeCloseTo(2 / 3);
    expect(r.averageDays).toBe(21);
  });
});
