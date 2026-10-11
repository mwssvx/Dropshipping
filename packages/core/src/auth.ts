// Development auth: email and password with scrypt, opaque session tokens stored hashed.
// Production swaps this module for Supabase Auth; the rest of core only needs a user id.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, count, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import type { Mailer } from "./email";
import { UserError } from "./errors";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters for your password."),
  name: z.string().trim().max(100).optional(),
});

export async function signUp(db: Db, input: { email: string; password: string; name?: string }) {
  const parsed = credentials.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { email, password, name } = parsed.data;
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (existing) throw new UserError("An account with this email already exists. Sign in instead.", "exists");
  const [user] = await db
    .insert(schema.users)
    .values({ email, name, passwordHash: await hashPassword(password) })
    .returning({ id: schema.users.id, email: schema.users.email });
  return user!;
}

const MINUTE = 60_000;
/** Wrong passwords allowed for one email in 15 minutes, counted since its last good sign-in. */
export const MAX_FAILED_SIGN_INS = 8;

export async function signIn(db: Db, input: { email: string; password: string }, now = new Date()) {
  const email = input.email.trim().toLowerCase();
  const recent = await db.query.authAttempts.findMany({
    where: and(eq(schema.authAttempts.email, email), gt(schema.authAttempts.createdAt, new Date(now.getTime() - 15 * MINUTE))),
    orderBy: desc(schema.authAttempts.createdAt),
    limit: 50,
  });
  const lastOk = recent.findIndex((a) => a.ok);
  const failures = (lastOk === -1 ? recent : recent.slice(0, lastOk)).length;
  if (failures >= MAX_FAILED_SIGN_INS) {
    throw new UserError("Too many wrong passwords for this email. Wait 15 minutes, or reset your password.", "throttled");
  }
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  const ok = !!user && (await verifyPassword(input.password, user.passwordHash));
  await db.insert(schema.authAttempts).values({ email: email.slice(0, 320), ok, createdAt: now });
  if (!ok) throw new UserError("That email and password don't match.", "bad_credentials");
  return { id: user!.id, email: user!.email };
}

/**
 * Emails a one-time link to set a new password, valid for an hour. Says nothing about whether the
 * email has an account, and sends at most three links an hour.
 */
export async function requestPasswordReset(
  ctx: { db: Db; mailer: Mailer; brand: string; resetUrl: (token: string) => string },
  emailInput: string,
  now = new Date(),
) {
  const email = emailInput.trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) throw new UserError("Enter a valid email address.");
  const user = await ctx.db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!user) return;
  const [recent] = await ctx.db
    .select({ n: count() })
    .from(schema.passwordResets)
    .where(and(eq(schema.passwordResets.userId, user.id), gt(schema.passwordResets.createdAt, new Date(now.getTime() - 60 * MINUTE))));
  if (Number(recent?.n ?? 0) >= 3) return;
  const token = randomBytes(32).toString("base64url");
  await ctx.db.insert(schema.passwordResets).values({ tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(now.getTime() + 60 * MINUTE), createdAt: now });
  await ctx.mailer.send({
    to: user.email,
    subject: `Reset your ${ctx.brand} password`,
    text: [
      "Someone asked to reset the password for this email. If it was you, set a new one here within an hour:",
      "",
      ctx.resetUrl(token),
      "",
      "If it wasn't you, ignore this email. Your password stays the same.",
    ].join("\n"),
  });
}

/** Sets a new password from a reset link, then signs the person out everywhere else. */
export async function resetPassword(db: Db, token: string, password: string, now = new Date()) {
  const pw = credentials.shape.password.safeParse(password);
  if (!pw.success) throw new UserError(pw.error.issues[0]!.message);
  const row = await db.query.passwordResets.findFirst({ where: and(eq(schema.passwordResets.tokenHash, hashToken(token)), isNull(schema.passwordResets.usedAt)) });
  if (!row || row.expiresAt <= now) throw new UserError("This link has expired or was already used. Ask for a new one.", "expired");
  await db.transaction(async (tx) => {
    await tx.update(schema.passwordResets).set({ usedAt: now }).where(eq(schema.passwordResets.tokenHash, row.tokenHash));
    await tx.update(schema.users).set({ passwordHash: await hashPassword(pw.data) }).where(eq(schema.users.id, row.userId));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, row.userId));
  });
  const user = (await db.query.users.findFirst({ where: eq(schema.users.id, row.userId) }))!;
  return { id: user.id, email: user.email };
}

/** Drops old sign-in attempts, used or expired reset links and unfinished two-step sign-ins. Run by the scheduled job. */
export async function pruneAuthRecords(db: Db, now = new Date()) {
  await db.delete(schema.authAttempts).where(lt(schema.authAttempts.createdAt, new Date(now.getTime() - 24 * 60 * MINUTE)));
  await db.delete(schema.passwordResets).where(lt(schema.passwordResets.expiresAt, new Date(now.getTime() - 24 * 60 * MINUTE)));
  await db.delete(schema.signInChallenges).where(lt(schema.signInChallenges.expiresAt, now));
}

/** Signs someone in. The device ("Chrome on Mac") shows in their list of where they're signed in. */
export async function createSession(db: Db, userId: string, device?: string | null) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ tokenHash: hashToken(token), userId, expiresAt, device: device ?? null, lastSeenAt: now });
  return { token, expiresAt };
}

/** How often a session's "last active" time is saved: often enough to be useful, not on every page. */
const SEEN_EVERY = 5 * MINUTE;

export async function getSessionUser(db: Db, token: string | undefined) {
  if (!token) return null;
  const now = new Date();
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, lastSeenAt: schema.sessions.lastSeenAt })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, tokenHash), gt(schema.sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  if (!row.lastSeenAt || now.getTime() - row.lastSeenAt.getTime() > SEEN_EVERY) {
    await db.update(schema.sessions).set({ lastSeenAt: now }).where(eq(schema.sessions.tokenHash, tokenHash));
  }
  return { id: row.id, email: row.email, name: row.name };
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
}
