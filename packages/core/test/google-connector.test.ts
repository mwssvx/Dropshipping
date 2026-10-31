import { describe, expect, it } from "vitest";
import { askAssistant, connectGoogle, decideAction, DemoModel, disconnectGoogle, FakeGoogleProvider, getConnector, googleToken, openToken, parseEventTime, sealToken, UserError } from "../src";
import { makeFixture } from "../evals/fixture";

const REDIRECT = "https://app.example/api/connectors/google/callback";

async function connected() {
  const f = await makeFixture(new DemoModel());
  const google = new FakeGoogleProvider();
  f.ctx.google = google;
  f.ctx.connectorSecret = "test-secret";
  const shop = await f.shop();
  const gctx = { db: f.db, google, connectorSecret: "test-secret" };
  await connectGoogle(gctx, shop.id, { code: "fake-code", redirectUri: REDIRECT, userId: null });
  return { f, google, shop, gctx };
}

describe("the Google connector", () => {
  it("seals tokens at rest, keeps the refresh token on a reconnect, and renews an expiring token", async () => {
    expect(openToken(sealToken("abc", "k"), "k")).toBe("abc");
    expect(sealToken("abc", "k").startsWith("gcm:")).toBe(true);
    expect(sealToken("abc", undefined)).toBe("plain:abc");
    expect(() => openToken(sealToken("abc", "k"), "other")).toThrow();

    const { f, google, shop, gctx } = await connected();
    const row = (await getConnector(f.db, shop.id))!;
    expect(row.accountEmail).toBe("owner@gmail.example");
    expect(row.accessToken.startsWith("gcm:")).toBe(true);
    expect(row.scopes).toContain("https://www.googleapis.com/auth/gmail.send");
    expect((await googleToken(gctx, shop.id)).token.startsWith("fake-access-")).toBe(true);
    expect(google.refreshes).toBe(0);

    // About to expire: renewed and saved.
    google.tokenSeconds = 30;
    await connectGoogle(gctx, shop.id, { code: "fake-code", redirectUri: REDIRECT, userId: null });
    await googleToken(gctx, shop.id);
    expect(google.refreshes).toBe(1);
    expect((await getConnector(f.db, shop.id))!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 20_000);

    await disconnectGoogle(f.db, shop.id);
    await expect(googleToken(gctx, shop.id)).rejects.toThrow(/isn't connected/);
  });

  it("the Assistant reads email and the calendar, and sending or adding waits for the owner's OK", async () => {
    const { f, google, shop } = await connected();
    const inbox = await askAssistant(f.ctx, shop, "Any new emails from Demo Post?");
    expect(inbox.text).toContain("Demo Post: Order CJ-1001 has shipped");
    expect(inbox.text).not.toContain("Ada Buyer");
    const cal = await askAssistant(f.ctx, shop, "What's on my calendar this week?");
    expect(cal.text).toContain("Call with the lamp supplier");

    const mail = await askAssistant(f.ctx, shop, "Email ada@example.com about wholesale prices for the lamps");
    const pending = await f.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ tool: "send_email", reason: "It sends an email from your Gmail, as you." });
    expect(pending[0]!.input.preview).toEqual(expect.arrayContaining(["From owner@gmail.example to ada@example.com", "Subject: Wholesale prices for the lamps"]));
    expect(google.sent).toHaveLength(0);
    expect(mail.text).toMatch(/OK|approv/i);
    await decideAction(f.ctx, shop.id, pending[0]!.id, { approve: true, by: "owner" });
    expect(google.sent).toEqual([{ to: "ada@example.com", subject: "Wholesale prices for the lamps", text: expect.stringContaining("Glow Lamps") }]);

    await askAssistant(f.ctx, shop, "Put the sale launch on my calendar on 2026-12-01T09:00");
    const [event] = (await f.pending()).filter((a) => a.tool === "add_calendar_event");
    expect(event!.input.preview).toEqual(expect.arrayContaining([expect.stringMatching(/Dec 1.*9:00 AM.*10:00 AM/)]));
    await decideAction(f.ctx, shop.id, event!.id, { approve: true, by: "owner" });
    expect(google.events.map((e) => e.title)).toContain("Sale launch");
  });

  it("says plainly when Google isn't connected, and reads event times", async () => {
    const f = await makeFixture(new DemoModel());
    f.ctx.google = new FakeGoogleProvider();
    const r = await askAssistant(f.ctx, await f.shop(), "Check my inbox");
    expect(r.text).toContain("Connectors page");
    expect(parseEventTime("2026-11-15T14:00+01:00").toISOString()).toBe("2026-11-15T13:00:00.000Z");
    expect(parseEventTime("2026-11-15T14:00").toISOString()).toBe("2026-11-15T14:00:00.000Z");
    expect(parseEventTime("2026-11-15").toISOString()).toBe("2026-11-15T09:00:00.000Z");
    expect(() => parseEventTime("tomorrow at 3")).toThrow(UserError);
  });
});
