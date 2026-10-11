// Two-step sign-in: after the right password, a 6-digit code from an authenticator app (TOTP,
// RFC 6238, the kind Google Authenticator, 1Password and Authy make). A stolen password alone no
// longer opens a store, its money or its payouts. Ten recovery codes, each good once, cover a lost
// phone. Wrong codes are limited per person, however many sign-ins they start.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { verifyPassword } from "./auth";
import type { Mailer } from "./email";
import { UserError } from "./errors";

const STEP_SECONDS = 30;
const CHALLENGE_MINUTES = 10;
const MINUTE = 60_000;
export const RECOVERY_CODE_COUNT = 10;
/** Wrong codes allowed for one person in 15 minutes, counted since their last right one. */
export const MAX_WRONG_CODES = 5;

type Ctx = { db: Db; mailer: Mailer; brand: string };

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function toBase32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string) {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i === -1) throw new Error("Not base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 6-digit code for a base32 secret at a 30-second time step. */
export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", fromBase32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export const timeStep = (now: Date) => Math.floor(now.getTime() / 1000 / STEP_SECONDS);

/** What an authenticator app reads from the QR code. */
export function otpauthUri(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const tidyRecovery = (code: string) => code.replace(/[\s-]/g, "").toLowerCase();

function makeRecoveryCodes() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = randomBytes(10);
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

const attemptKey = (userId: string) => `two-step:${userId}`;

async function wrongCodesLately(db: Db, userId: string, now: Date) {
  const recent = await db.query.authAttempts.findMany({
    where: and(eq(schema.authAttempts.email, attemptKey(userId)), gt(schema.authAttempts.createdAt, new Date(now.getTime() - 15 * MINUTE))),
    orderBy: desc(schema.authAttempts.createdAt),
    limit: 50,
  });
  const lastOk = recent.findIndex((a) => a.ok);
  return (lastOk === -1 ? recent : recent.slice(0, lastOk)).length;
}

type Checked = { kind: "app"; step: number } | { kind: "recovery"; left: string[] };

/**
 * Checks a code against someone's app (this step or the one either side, never a step already
 * used) or their recovery codes. Counts wrong codes and refuses once there were too many.
 */
async function checkCode(db: Db, user: typeof schema.users.$inferSelect, secret: string, input: string, now: Date, allowRecovery = true): Promise<Checked> {
  if ((await wrongCodesLately(db, user.id, now)) >= MAX_WRONG_CODES) {
    throw new UserError("Too many wrong codes. Wait 15 minutes and try again.", "throttled");
  }
  const digits = input.replace(/\s/g, "");
  let result: Checked | null = null;
  if (/^\d{6}$/.test(digits)) {
    const step = timeStep(now);
    for (const s of [step - 1, step, step + 1]) {
      if (user.twoStepLastStep !== null && s <= user.twoStepLastStep) continue;
      if (timingSafeEqual(Buffer.from(totpCode(secret, s)), Buffer.from(digits))) result = { kind: "app", step: s };
    }
  } else if (allowRecovery && tidyRecovery(input).length === 10) {
    const hash = sha256(tidyRecovery(input));
    if (user.recoveryCodes.includes(hash)) result = { kind: "recovery", left: user.recoveryCodes.filter((h) => h !== hash) };
  }
  await db.insert(schema.authAttempts).values({ email: attemptKey(user.id), ok: !!result, createdAt: now });
  if (!result) throw new UserError(allowRecovery ? "That code isn't right. Check the time on your phone, or use a recovery code." : "That code isn't right. Check the time on your phone and try the newest code.", "bad_code");
  return result;
}

/** Saves what a right code used up: its time step, or the recovery code. */
async function useCode(db: Db, userId: string, checked: Checked) {
  await db
    .update(schema.users)
    .set(checked.kind === "app" ? { twoStepLastStep: checked.step } : { recoveryCodes: checked.left })
    .where(eq(schema.users.id, userId));
}

async function loadUser(db: Db, userId: string) {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) throw new UserError("Sign in again.");
  return user;
}

export async function twoStepStatus(db: Db, userId: string) {
  const user = await loadUser(db, userId);
  return { on: !!user.twoStepOnAt, since: user.twoStepOnAt, recoveryCodesLeft: user.twoStepOnAt ? user.recoveryCodes.length : 0 };
}

/** A new secret to scan, saved but not used until a code from it is confirmed. */
export async function startTwoStepSetup(db: Db, userId: string, issuer: string) {
  const user = await loadUser(db, userId);
  if (user.twoStepOnAt) throw new UserError("Two-step sign-in is already on.");
  const secret = toBase32(randomBytes(20));
  await db.update(schema.users).set({ twoStepSecret: secret, twoStepLastStep: null }).where(eq(schema.users.id, userId));
  return { secret, uri: otpauthUri(secret, user.email, issuer) };
}

/** The secret being set up, so the page can show it again after a wrong code. */
export async function pendingTwoStep(db: Db, userId: string, issuer: string) {
  const user = await loadUser(db, userId);
  if (user.twoStepOnAt || !user.twoStepSecret) return null;
  return { secret: user.twoStepSecret, uri: otpauthUri(user.twoStepSecret, user.email, issuer) };
}

/**
 * Turns two-step sign-in on with a code from the app just set up. Signs out every other device
 * (keepToken is the session doing this) and returns the recovery codes, shown this once.
 */
export async function confirmTwoStep(ctx: Ctx, userId: string, code: string, keepToken?: string, now = new Date()) {
  const user = await loadUser(ctx.db, userId);
  if (user.twoStepOnAt) throw new UserError("Two-step sign-in is already on.");
  if (!user.twoStepSecret) throw new UserError("Start again: scan the new code with your app.");
  const checked = await checkCode(ctx.db, user, user.twoStepSecret, code, now, false);
  const codes = makeRecoveryCodes();
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ twoStepOnAt: now, twoStepLastStep: checked.kind === "app" ? checked.step : null, recoveryCodes: codes.map((c) => sha256(tidyRecovery(c))) })
      .where(eq(schema.users.id, userId));
    const others = keepToken ? and(eq(schema.sessions.userId, userId), ne(schema.sessions.tokenHash, sha256(keepToken))) : eq(schema.sessions.userId, userId);
    await tx.delete(schema.sessions).where(others);
  });
  await ctx.mailer.send({
    to: user.email,
    subject: `Two-step sign-in is on for your ${ctx.brand} account`,
    text: [
      "From now on, signing in takes your password and a code from your authenticator app.",
      "Other devices were signed out. Keep your recovery codes somewhere safe, apart from your phone.",
      "",
      "If this wasn't you, reset your password straight away and contact support.",
    ].join("\n"),
  });
  return { recoveryCodes: codes };
}

/** New recovery codes in place of the old ones, after a code from the app. */
export async function renewRecoveryCodes(db: Db, userId: string, code: string, now = new Date()) {
  const user = await loadUser(db, userId);
  if (!user.twoStepOnAt || !user.twoStepSecret) throw new UserError("Turn on two-step sign-in first.");
  const checked = await checkCode(db, user, user.twoStepSecret, code, now, false);
  const codes = makeRecoveryCodes();
  await db
    .update(schema.users)
    .set({ twoStepLastStep: checked.kind === "app" ? checked.step : user.twoStepLastStep, recoveryCodes: codes.map((c) => sha256(tidyRecovery(c))) })
    .where(eq(schema.users.id, userId));
  return { recoveryCodes: codes };
}

/** Turns two-step sign-in off. Takes the password and a code (or a recovery code), and says so by email. */
export async function turnOffTwoStep(ctx: Ctx, userId: string, input: { password: string; code: string }, now = new Date()) {
  const user = await loadUser(ctx.db, userId);
  if (!user.twoStepOnAt || !user.twoStepSecret) throw new UserError("Two-step sign-in is already off.");
  if (!(await verifyPassword(input.password, user.passwordHash))) throw new UserError("That password isn't right.", "bad_credentials");
  await checkCode(ctx.db, user, user.twoStepSecret, input.code, now);
  await ctx.db
    .update(schema.users)
    .set({ twoStepSecret: null, twoStepOnAt: null, twoStepLastStep: null, recoveryCodes: [] })
    .where(eq(schema.users.id, userId));
  await ctx.mailer.send({
    to: user.email,
    subject: `Two-step sign-in was turned off for your ${ctx.brand} account`,
    text: [
      "Signing in now takes only your password.",
      "",
      "If this wasn't you, reset your password straight away, turn two-step sign-in back on and contact support.",
    ].join("\n"),
  });
}

/**
 * After the right password: for someone with two-step sign-in on, a token for the code step (good
 * for 10 minutes); null when they can be signed in straight away.
 */
export async function twoStepChallenge(db: Db, userId: string, now = new Date()) {
  const user = await loadUser(db, userId);
  if (!user.twoStepOnAt) return null;
  const token = randomBytes(32).toString("base64url");
  await db.insert(schema.signInChallenges).values({ tokenHash: sha256(token), userId, expiresAt: new Date(now.getTime() + CHALLENGE_MINUTES * MINUTE), createdAt: now });
  return token;
}

/** The code step of signing in. Returns who signed in; the caller then starts their session. */
export async function finishTwoStep(ctx: Ctx, token: string, code: string, now = new Date()) {
  const row = await ctx.db.query.signInChallenges.findFirst({ where: eq(schema.signInChallenges.tokenHash, sha256(token)) });
  if (!row || row.expiresAt <= now) throw new UserError("That took too long. Sign in again.", "expired");
  const user = await loadUser(ctx.db, row.userId);
  if (!user.twoStepOnAt || !user.twoStepSecret) throw new UserError("Sign in again.", "expired");
  const checked = await checkCode(ctx.db, user, user.twoStepSecret, code, now);
  await useCode(ctx.db, user.id, checked);
  await ctx.db.delete(schema.signInChallenges).where(eq(schema.signInChallenges.userId, user.id));
  if (checked.kind === "recovery") {
    await ctx.mailer.send({
      to: user.email,
      subject: `A recovery code was used to sign in to ${ctx.brand}`,
      text: [
        `Someone signed in to your account with a recovery code. ${checked.left.length === 1 ? "1 code is" : `${checked.left.length} codes are`} left.`,
        "If you lost your phone, set up two-step sign-in again on the new one and make new recovery codes.",
        "",
        "If this wasn't you, reset your password straight away and contact support.",
      ].join("\n"),
    });
  }
  return { id: user.id, email: user.email, recoveryCodesLeft: checked.kind === "recovery" ? checked.left.length : null };
}
