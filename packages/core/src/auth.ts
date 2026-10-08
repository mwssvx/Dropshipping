// Development auth: email and password with scrypt, opaque session tokens stored hashed.
// Production swaps this module for Supabase Auth; the rest of core only needs a user id.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
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

export async function signIn(db: Db, input: { email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new UserError("That email and password don't match.", "bad_credentials");
  }
  return { id: user.id, email: user.email };
}

export async function createSession(db: Db, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function getSessionUser(db: Db, token: string | undefined) {
  if (!token) return null;
  const row = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, hashToken(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return row[0] ?? null;
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
}
