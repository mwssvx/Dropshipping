import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  confirmTwoStep, createSession, DemoModel, finishTwoStep, getSessionUser, MAX_WRONG_CODES, pendingTwoStep, pruneAuthRecords, renewRecoveryCodes, signIn, signUp,
  startTwoStepSetup, timeStep, toBase32, totpCode, turnOffTwoStep, twoStepChallenge, twoStepStatus,
} from "../src";
import { makeFixture } from "../evals/fixture";

const brand = "Storefront";
const at = (iso: string) => new Date(iso);
const codeAt = (secret: string, now: Date, offset = 0) => totpCode(secret, timeStep(now) + offset);

async function setup() {
  const f = await makeFixture(new DemoModel());
  const ctx = { db: f.db, mailer: f.mailer, brand };
  const user = await signUp(f.db, { email: "two@example.com", password: "correct horse" });
  return { f, ctx, user };
}

describe("two-step sign-in", () => {
  it("makes the same codes as authenticator apps (RFC 6238)", () => {
    const secret = toBase32(Buffer.from("12345678901234567890"));
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    // The RFC's 8-digit codes, cut to the last 6 digits.
    expect(totpCode(secret, timeStep(new Date(59_000)))).toBe("287082");
    expect(totpCode(secret, timeStep(new Date(1_111_111_109_000)))).toBe("081804");
    expect(totpCode(secret, timeStep(new Date(2_000_000_000_000)))).toBe("279037");
  });

  it("turns on with a code from the app, and then signing in needs a code", async () => {
    const { f, ctx, user } = await setup();
    const now = at("2026-10-11T12:00:00Z");
    expect(await twoStepChallenge(f.db, user.id, now)).toBeNull();

    const { secret, uri } = await startTwoStepSetup(f.db, user.id, brand);
    expect(uri).toBe(`otpauth://totp/Storefront%3Atwo%40example.com?secret=${secret}&issuer=Storefront&algorithm=SHA1&digits=6&period=30`);
    expect(await pendingTwoStep(f.db, user.id, brand)).toEqual({ secret, uri });
    // Not on until a code from the app is confirmed.
    expect((await twoStepStatus(f.db, user.id)).on).toBe(false);
    expect(await twoStepChallenge(f.db, user.id, now)).toBeNull();

    const here = await createSession(f.db, user.id);
    const elsewhere = await createSession(f.db, user.id);
    await expect(confirmTwoStep(ctx, user.id, "000000", here.token, now)).rejects.toThrow("That code isn't right");
    const { recoveryCodes } = await confirmTwoStep(ctx, user.id, codeAt(secret, now), here.token, now);
    expect(recoveryCodes).toHaveLength(10);
    expect(recoveryCodes[0]).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(await twoStepStatus(f.db, user.id)).toEqual({ on: true, since: now, recoveryCodesLeft: 10 });
    // Other devices are signed out; this one stays.
    expect(await getSessionUser(f.db, here.token)).not.toBeNull();
    expect(await getSessionUser(f.db, elsewhere.token)).toBeNull();
    expect(f.mailer.sent.at(-1)!.subject).toBe("Two-step sign-in is on for your Storefront account");
    // Only the hashes are kept.
    const row = await f.db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
    expect(row!.recoveryCodes).not.toContain(recoveryCodes[0]);

    // The password alone doesn't sign in any more.
    await signIn(f.db, { email: "two@example.com", password: "correct horse" }, now);
    const later = new Date(now.getTime() + 60_000);
    const token = (await twoStepChallenge(f.db, user.id, later))!;
    expect(token).toBeTruthy();
    await expect(finishTwoStep(ctx, token, "123456", later)).rejects.toThrow("That code isn't right");
    expect(await finishTwoStep(ctx, token, ` ${codeAt(secret, later).slice(0, 3)} ${codeAt(secret, later).slice(3)} `, later)).toEqual({ id: user.id, email: "two@example.com", recoveryCodesLeft: null });
    // The sign-in step is used up, and so is that code.
    await expect(finishTwoStep(ctx, token, codeAt(secret, later), later)).rejects.toThrow("Sign in again");
    const again = (await twoStepChallenge(f.db, user.id, later))!;
    await expect(finishTwoStep(ctx, again, codeAt(secret, later), later)).rejects.toThrow("That code isn't right");
    // The next code works, and so does one a step early or late (phone clocks drift).
    const next = new Date(later.getTime() + 30_000);
    expect((await finishTwoStep(ctx, again, codeAt(secret, next, 1), next)).id).toBe(user.id);

    // The step expires after 10 minutes, and old ones are cleared away.
    const stale = (await twoStepChallenge(f.db, user.id, next))!;
    const tooLate = new Date(next.getTime() + 11 * 60_000);
    await expect(finishTwoStep(ctx, stale, codeAt(secret, tooLate), tooLate)).rejects.toThrow("That took too long");
    await pruneAuthRecords(f.db, tooLate);
    expect(await f.db.query.signInChallenges.findMany()).toHaveLength(0);
  });

  it("takes each recovery code once, says so by email, and can make new ones", async () => {
    const { f, ctx, user } = await setup();
    const now = at("2026-10-11T12:00:00Z");
    const { secret } = await startTwoStepSetup(f.db, user.id, brand);
    const { recoveryCodes } = await confirmTwoStep(ctx, user.id, codeAt(secret, now), undefined, now);

    const token = (await twoStepChallenge(f.db, user.id, now))!;
    const typed = recoveryCodes[3]!.toUpperCase().replace("-", " ");
    expect(await finishTwoStep(ctx, token, typed, now)).toMatchObject({ recoveryCodesLeft: 9 });
    expect(f.mailer.sent.at(-1)!.subject).toBe("A recovery code was used to sign in to Storefront");
    expect(f.mailer.sent.at(-1)!.text).toContain("9 codes are left");
    const reuse = (await twoStepChallenge(f.db, user.id, now))!;
    await expect(finishTwoStep(ctx, reuse, recoveryCodes[3]!, now)).rejects.toThrow("That code isn't right");

    // New codes need a code from the app, and replace every old one.
    const later = new Date(now.getTime() + 60_000);
    await expect(renewRecoveryCodes(f.db, user.id, recoveryCodes[4]!, later)).rejects.toThrow("That code isn't right");
    const fresh = await renewRecoveryCodes(f.db, user.id, codeAt(secret, later), later);
    expect(fresh.recoveryCodes).toHaveLength(10);
    await expect(finishTwoStep(ctx, reuse, recoveryCodes[5]!, later)).rejects.toThrow("That code isn't right");
    expect((await finishTwoStep(ctx, reuse, fresh.recoveryCodes[0]!, later)).id).toBe(user.id);
  });

  it("stops guessing after 5 wrong codes, however many sign-ins are started", async () => {
    const { f, ctx, user } = await setup();
    const now = at("2026-10-11T12:00:00Z");
    const { secret } = await startTwoStepSetup(f.db, user.id, brand);
    await confirmTwoStep(ctx, user.id, codeAt(secret, now), undefined, now);
    for (let i = 1; i <= MAX_WRONG_CODES; i++) {
      const t = new Date(now.getTime() + i * 1000);
      const token = (await twoStepChallenge(f.db, user.id, t))!;
      await expect(finishTwoStep(ctx, token, "000000", t)).rejects.toThrow("That code isn't right");
    }
    const token = (await twoStepChallenge(f.db, user.id, now))!;
    const later = new Date(now.getTime() + 60_000);
    await expect(finishTwoStep(ctx, token, codeAt(secret, later), later)).rejects.toThrow("Too many wrong codes");
    const after = new Date(now.getTime() + 16 * 60_000);
    const fresh = (await twoStepChallenge(f.db, user.id, after))!;
    expect((await finishTwoStep(ctx, fresh, codeAt(secret, after), after)).id).toBe(user.id);
  });

  it("turns off only with the password and a code", async () => {
    const { f, ctx, user } = await setup();
    const now = at("2026-10-11T12:00:00Z");
    const { secret } = await startTwoStepSetup(f.db, user.id, brand);
    const { recoveryCodes } = await confirmTwoStep(ctx, user.id, codeAt(secret, now), undefined, now);
    await expect(startTwoStepSetup(f.db, user.id, brand)).rejects.toThrow("already on");
    const later = new Date(now.getTime() + 60_000);
    await expect(turnOffTwoStep(ctx, user.id, { password: "wrong password", code: codeAt(secret, later) }, later)).rejects.toThrow("That password isn't right");
    await expect(turnOffTwoStep(ctx, user.id, { password: "correct horse", code: "111111" }, later)).rejects.toThrow("That code isn't right");
    // A lost phone: a recovery code does it too.
    await turnOffTwoStep(ctx, user.id, { password: "correct horse", code: recoveryCodes[0]! }, later);
    expect(await twoStepStatus(f.db, user.id)).toEqual({ on: false, since: null, recoveryCodesLeft: 0 });
    expect(f.mailer.sent.at(-1)!.subject).toBe("Two-step sign-in was turned off for your Storefront account");
    expect(await twoStepChallenge(f.db, user.id, later)).toBeNull();
    expect(await pendingTwoStep(f.db, user.id, brand)).toBeNull();
  });
});
