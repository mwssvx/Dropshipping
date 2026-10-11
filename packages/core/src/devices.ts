// Where someone is signed in: each session's device and when it was last used, with a way to sign
// any of them out, and an email when someone signs in on a device they haven't used before.
import { createHash } from "node:crypto";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import type { Mailer } from "./email";
import { NotFoundError } from "./errors";

const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");

export const APP_DEVICE = "Merchant app";

/** A short, readable name for a browser's user agent, like "Chrome on Mac". */
export function describeDevice(userAgent: string | null | undefined) {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? (system ? `A browser on ${system}` : "Unknown browser");
}

/** Everywhere this person is signed in, most recently used first; current is the one asking. */
export async function listSignIns(db: Db, userId: string, currentToken: string | undefined, now = new Date()) {
  const current = currentToken ? sha256(currentToken) : null;
  const rows = await db.query.sessions.findMany({
    where: and(eq(schema.sessions.userId, userId), gt(schema.sessions.expiresAt, now)),
    orderBy: [desc(schema.sessions.lastSeenAt), desc(schema.sessions.createdAt)],
  });
  return rows
    .map((r) => ({ id: r.tokenHash, device: r.device ?? "Unknown browser", signedInAt: r.createdAt, lastSeenAt: r.lastSeenAt ?? r.createdAt, current: r.tokenHash === current }))
    .sort((a, b) => Number(b.current) - Number(a.current));
}

/** Signs out one of this person's sessions (never someone else's). */
export async function endSignIn(db: Db, userId: string, id: string) {
  const gone = await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.tokenHash, id), eq(schema.sessions.userId, userId)))
    .returning({ id: schema.sessions.tokenHash });
  if (!gone.length) throw new NotFoundError("Sign-in");
}

/** Signs out everywhere except the session asking. Returns how many were signed out. */
export async function endOtherSignIns(db: Db, userId: string, currentToken: string) {
  const gone = await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), ne(schema.sessions.tokenHash, sha256(currentToken))))
    .returning({ id: schema.sessions.tokenHash });
  return gone.length;
}

const KNOWN_DEVICES = 20;

/**
 * When a session starts: remembers the device, and emails the person when they sign in on one
 * they haven't used before. Nothing is sent for the first device on record (signing up, or the
 * first sign-in after this was added).
 */
export async function noteDevice(ctx: { db: Db; mailer: Mailer; brand: string; manageUrl: string }, userId: string, device: string, now = new Date()) {
  const user = await ctx.db.query.users.findFirst({ where: eq(schema.users.id, userId), columns: { email: true, knownDevices: true } });
  if (!user || user.knownDevices.includes(device)) return false;
  await ctx.db
    .update(schema.users)
    .set({ knownDevices: [device, ...user.knownDevices].slice(0, KNOWN_DEVICES) })
    .where(eq(schema.users.id, userId));
  if (!user.knownDevices.length) return false;
  const when = now.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  await ctx.mailer.send({
    to: user.email,
    subject: `New sign-in to your ${ctx.brand} account`,
    text: [
      `Your account was just signed in to on ${device}, ${when} UTC.`,
      "",
      "If it was you, there's nothing to do.",
      `If it wasn't, change your password and sign that device out here: ${ctx.manageUrl}`,
      "Turning on two-step sign-in there stops this happening again.",
    ].join("\n"),
  });
  return true;
}
