import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { APP_DEVICE, createSession, DemoModel, describeDevice, endOtherSignIns, endSignIn, getSessionUser, listSignIns, noteDevice, signUp } from "../src";
import { makeFixture } from "../evals/fixture";

const UA = {
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  androidChrome: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
};

describe("where you're signed in", () => {
  it("names devices from their browser", () => {
    expect(describeDevice(UA.macChrome)).toBe("Chrome on Mac");
    expect(describeDevice(UA.winEdge)).toBe("Edge on Windows");
    expect(describeDevice(UA.iphoneSafari)).toBe("Safari on iPhone");
    expect(describeDevice(UA.androidChrome)).toBe("Chrome on Android");
    expect(describeDevice(UA.linuxFirefox)).toBe("Firefox on Linux");
    expect(describeDevice("curl/8.5.0")).toBe("Unknown browser");
    expect(describeDevice(null)).toBe("Unknown browser");
  });

  it("lists each sign-in with this one first, and signs out one or all the others", async () => {
    const f = await makeFixture(new DemoModel());
    const user = await signUp(f.db, { email: "devices@example.com", password: "correct horse" });
    const other = await signUp(f.db, { email: "other@example.com", password: "correct horse" });
    const laptop = await createSession(f.db, user.id, "Chrome on Mac");
    const phone = await createSession(f.db, user.id, APP_DEVICE);
    const old = await createSession(f.db, user.id, "Firefox on Linux");
    const theirs = await createSession(f.db, other.id, "Safari on iPhone");

    const list = await listSignIns(f.db, user.id, phone.token);
    expect(list.map((s) => [s.device, s.current])).toEqual([[APP_DEVICE, true], expect.anything(), expect.anything()]);
    expect(list.map((s) => s.device).sort()).toEqual([APP_DEVICE, "Chrome on Mac", "Firefox on Linux"].sort());

    // Someone else's sign-in can't be ended from here.
    const theirId = (await listSignIns(f.db, other.id, undefined))[0]!.id;
    await expect(endSignIn(f.db, user.id, theirId)).rejects.toThrow();
    expect(await getSessionUser(f.db, theirs.token)).not.toBeNull();

    await endSignIn(f.db, user.id, list.find((s) => s.device === "Firefox on Linux")!.id);
    expect(await getSessionUser(f.db, old.token)).toBeNull();
    expect(await endOtherSignIns(f.db, user.id, phone.token)).toBe(1);
    expect(await getSessionUser(f.db, laptop.token)).toBeNull();
    expect(await getSessionUser(f.db, phone.token)).not.toBeNull();
    expect(await getSessionUser(f.db, theirs.token)).not.toBeNull();
  });

  it("keeps when each was last used, without writing on every page", async () => {
    const f = await makeFixture(new DemoModel());
    const user = await signUp(f.db, { email: "seen@example.com", password: "correct horse" });
    const s = await createSession(f.db, user.id, "Chrome on Mac");
    const row = () => f.db.query.sessions.findFirst({ where: eq(schema.sessions.userId, user.id) });
    const hourAgo = new Date(Date.now() - 3_600_000);
    await f.db.update(schema.sessions).set({ lastSeenAt: hourAgo }).where(eq(schema.sessions.userId, user.id));
    await getSessionUser(f.db, s.token);
    const seen = (await row())!.lastSeenAt!;
    expect(seen.getTime()).toBeGreaterThan(hourAgo.getTime());
    await getSessionUser(f.db, s.token);
    expect((await row())!.lastSeenAt!.getTime()).toBe(seen.getTime());
  });

  it("emails a sign-in on a new kind of device, but not the first one or a known one", async () => {
    const f = await makeFixture(new DemoModel());
    const ctx = { db: f.db, mailer: f.mailer, brand: "Storefront", manageUrl: "https://admin.example.com/admin/account" };
    const user = await signUp(f.db, { email: "alerts@example.com", password: "correct horse" });
    const sent = () => f.mailer.sent.filter((m) => m.to === "alerts@example.com");
    expect(await noteDevice(ctx, user.id, "Chrome on Mac")).toBe(false);
    expect(await noteDevice(ctx, user.id, "Chrome on Mac")).toBe(false);
    expect(sent()).toHaveLength(0);
    expect(await noteDevice(ctx, user.id, "Edge on Windows", new Date("2026-10-11T14:05:00Z"))).toBe(true);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.subject).toBe("New sign-in to your Storefront account");
    expect(sent()[0]!.text).toContain("signed in to on Edge on Windows, Oct 11, 2026, 2:05 PM UTC.");
    expect(sent()[0]!.text).toContain("https://admin.example.com/admin/account");
    expect(await noteDevice(ctx, user.id, "Edge on Windows")).toBe(false);
    expect(sent()).toHaveLength(1);
  });
});
