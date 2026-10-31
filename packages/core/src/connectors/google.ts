// Google for the Assistant: the owner connects their Google account once (Connectors page), and the
// Assistant can then read their Gmail, send an email as them (with their OK), and read or add
// calendar events (adding waits for their OK too). Without GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET a fake Google stands in, with a small inbox and calendar, so the whole flow
// works in development and tests.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "../errors";

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/calendar.events", "openid", "email"];
export const EMAIL_LIST_MAX = 10;
export const EMAIL_BODY_MAX = 4000;
export const CALENDAR_DAYS_MAX = 60;

export type GoogleTokens = { accessToken: string; refreshToken: string | null; expiresAt: Date | null; email: string | null; scopes: string[] };
export type EmailSummary = { id: string; from: string; subject: string; date: string; snippet: string };
export type Email = EmailSummary & { to: string; text: string };
export type CalendarEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location: string | null; link: string | null };

export interface GoogleProvider {
  readonly name: "google" | "fake";
  /** Where to send the owner to say yes. */
  authUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens>;
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date | null }>;
  /** Tells Google the store no longer uses this sign-in, so the tokens stop working. */
  revoke(token: string): Promise<void>;
  listEmails(token: string, input: { query: string | null; max: number }): Promise<EmailSummary[]>;
  getEmail(token: string, id: string): Promise<Email | null>;
  sendEmail(token: string, input: { to: string; subject: string; text: string }): Promise<{ id: string }>;
  listEvents(token: string, input: { from: Date; to: Date; max: number }): Promise<CalendarEvent[]>;
  createEvent(token: string, input: { title: string; start: Date; end: Date; allDay: boolean; description: string | null; location: string | null }): Promise<CalendarEvent>;
}

/* ───────────── Tokens at rest ───────────── */

/** AES-256-GCM with a key from CONNECTOR_SECRET; without one, stored as is with a "plain:" mark. */
export function sealToken(value: string, secret: string | undefined) {
  if (!secret) return `plain:${value}`;
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `gcm:${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function openToken(sealed: string, secret: string | undefined) {
  if (sealed.startsWith("plain:")) return sealed.slice(6);
  if (!sealed.startsWith("gcm:")) throw new Error("Unknown token format");
  if (!secret) throw new Error("CONNECTOR_SECRET is needed to read the connected account's token");
  const [iv, tag, body] = sealed.slice(4).split(".");
  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv!, "base64url"));
  decipher.setAuthTag(Buffer.from(tag!, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body!, "base64url")), decipher.final()]).toString("utf8");
}

/* ───────────── Connecting and using an account ───────────── */

export type GoogleContext = { db: Db; google: GoogleProvider; connectorSecret?: string };

export async function getConnector(db: Db, shopId: string, kind: "google" = "google") {
  return db.query.connectors.findFirst({ where: and(eq(schema.connectors.shopId, shopId), eq(schema.connectors.kind, kind)) });
}

/** After Google sends the owner back with a code: swap it for tokens and keep them for the store. */
export async function connectGoogle(ctx: GoogleContext, shopId: string, input: { code: string; redirectUri: string; userId: string | null }) {
  const t = await ctx.google.exchangeCode(input.code, input.redirectUri);
  const existing = await getConnector(ctx.db, shopId);
  const values = {
    accountEmail: t.email,
    accessToken: sealToken(t.accessToken, ctx.connectorSecret),
    // Google only sends a refresh token the first time; keep the one we have if this is a reconnect.
    refreshToken: t.refreshToken ? sealToken(t.refreshToken, ctx.connectorSecret) : (existing?.refreshToken ?? null),
    expiresAt: t.expiresAt,
    scopes: t.scopes,
    connectedBy: input.userId,
    updatedAt: new Date(),
  };
  if (existing) await ctx.db.update(schema.connectors).set(values).where(eq(schema.connectors.id, existing.id));
  else await ctx.db.insert(schema.connectors).values({ shopId, kind: "google", ...values });
  return { email: t.email };
}

/** Forgets the store's Google sign-in and asks Google to cancel it, so a copy of the saved tokens is useless afterwards. */
export async function disconnectGoogle(ctx: GoogleContext, shopId: string) {
  const c = await getConnector(ctx.db, shopId);
  if (!c) return;
  // Revoking the refresh token cancels every access token with it. Best effort: the row goes either way.
  for (const sealed of [c.refreshToken, c.accessToken]) {
    if (!sealed) continue;
    try {
      await ctx.google.revoke(openToken(sealed, ctx.connectorSecret));
      break;
    } catch {
      // Already revoked, unreadable, or Google is down: nothing more we can do here.
    }
  }
  await ctx.db.delete(schema.connectors).where(eq(schema.connectors.id, c.id));
}

/** The saved token as plain text, or a message the owner can act on when it can't be read any more. */
function savedToken(sealed: string, secret: string | undefined) {
  try {
    return openToken(sealed, secret);
  } catch {
    throw new UserError("The saved Google sign-in can't be read any more (the platform's connector secret changed). The owner needs to connect it again on the Connectors page.");
  }
}

/** A working access token for the store's Google account, refreshed when it's about to run out. */
export async function googleToken(ctx: GoogleContext, shopId: string) {
  const c = await getConnector(ctx.db, shopId);
  if (!c) throw new UserError("Google isn't connected. The owner can connect it on the Connectors page (Settings > Connectors).");
  if (c.expiresAt && c.expiresAt.getTime() - Date.now() < 60_000) {
    if (!c.refreshToken) throw new UserError("The Google connection has expired. The owner needs to connect it again on the Connectors page.");
    try {
      const fresh = await ctx.google.refresh(savedToken(c.refreshToken, ctx.connectorSecret));
      await ctx.db.update(schema.connectors).set({ accessToken: sealToken(fresh.accessToken, ctx.connectorSecret), expiresAt: fresh.expiresAt, updatedAt: new Date() }).where(eq(schema.connectors.id, c.id));
      return { token: fresh.accessToken, email: c.accountEmail };
    } catch (e) {
      if (e instanceof UserError) throw e;
      throw new UserError("Google wouldn't renew the connection. The owner needs to connect it again on the Connectors page.");
    }
  }
  return { token: savedToken(c.accessToken, ctx.connectorSecret), email: c.accountEmail };
}

/* ───────────── The real Google ───────────── */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary";

type GmailMessage = { id: string; snippet?: string; payload?: { headers?: { name: string; value: string }[]; mimeType?: string; body?: { data?: string }; parts?: GmailMessage["payload"][] } };

const header = (m: GmailMessage, name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
const decode = (b64: string) => Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

/** The plain-text part of a message, or the HTML with tags stripped. */
function bodyText(p: GmailMessage["payload"] | undefined): string {
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data) return decode(p.body.data);
  for (const part of p.parts ?? []) {
    const t = bodyText(part);
    if (t) return t;
  }
  if (p.mimeType === "text/html" && p.body?.data) return decode(p.body.data).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return "";
}

export class RealGoogleProvider implements GoogleProvider {
  readonly name = "google" as const;
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  authUrl({ state, redirectUri }: { state: string; redirectUri: string }) {
    const q = new URLSearchParams({ client_id: this.clientId, redirect_uri: redirectUri, response_type: "code", scope: GOOGLE_SCOPES.join(" "), access_type: "offline", prompt: "consent", state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  private async call<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const res = await this.fetcher(url, { ...init, headers: { ...(init.headers ?? {}), ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401) throw new UserError("Google no longer accepts the connection. The owner needs to connect it again on the Connectors page.");
      if (res.status === 403) throw new UserError("Google refused: the connection doesn't have permission for that. Connect it again to grant it.");
      throw new Error(`Google answered ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens> {
    const body = new URLSearchParams({ code, client_id: this.clientId, client_secret: this.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" });
    const t = await this.call<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string }>(TOKEN_URL, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    let email: string | null = null;
    if (t.id_token) {
      try {
        email = (JSON.parse(decode(t.id_token.split(".")[1]!)) as { email?: string }).email ?? null;
      } catch {
        email = null;
      }
    }
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null, email, scopes: t.scope?.split(" ") ?? [] };
  }

  async refresh(refreshToken: string) {
    const body = new URLSearchParams({ refresh_token: refreshToken, client_id: this.clientId, client_secret: this.clientSecret, grant_type: "refresh_token" });
    const t = await this.call<{ access_token: string; expires_in?: number }>(TOKEN_URL, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    return { accessToken: t.access_token, expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null };
  }

  async revoke(token: string) {
    await this.call<unknown>(`${REVOKE_URL}?${new URLSearchParams({ token })}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } });
  }

  async listEmails(token: string, input: { query: string | null; max: number }) {
    const q = new URLSearchParams({ maxResults: String(input.max), ...(input.query ? { q: input.query } : {}) });
    const list = await this.call<{ messages?: { id: string }[] }>(`${GMAIL}/messages?${q}`, { token });
    // The headers of each message, all at once rather than one after another.
    const out: EmailSummary[] = await Promise.all(
      (list.messages ?? []).map(async ({ id }) => {
        const m = await this.call<GmailMessage>(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { token });
        return { id, from: header(m, "From"), subject: header(m, "Subject"), date: header(m, "Date"), snippet: m.snippet ?? "" };
      }),
    );
    return out;
  }

  async getEmail(token: string, id: string) {
    try {
      const m = await this.call<GmailMessage>(`${GMAIL}/messages/${encodeURIComponent(id)}?format=full`, { token });
      return { id, from: header(m, "From"), to: header(m, "To"), subject: header(m, "Subject"), date: header(m, "Date"), snippet: m.snippet ?? "", text: bodyText(m.payload) };
    } catch (e) {
      if (e instanceof Error && /404/.test(e.message)) return null;
      throw e;
    }
  }

  async sendEmail(token: string, input: { to: string; subject: string; text: string }) {
    const raw = [`To: ${input.to}`, `Subject: =?UTF-8?B?${Buffer.from(input.subject).toString("base64")}?=`, "Content-Type: text/plain; charset=UTF-8", "MIME-Version: 1.0", "", input.text].join("\r\n");
    const res = await this.call<{ id: string }>(`${GMAIL}/messages/send`, { method: "POST", token, headers: { "content-type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }) });
    return { id: res.id };
  }

  async listEvents(token: string, input: { from: Date; to: Date; max: number }) {
    const q = new URLSearchParams({ timeMin: input.from.toISOString(), timeMax: input.to.toISOString(), maxResults: String(input.max), singleEvents: "true", orderBy: "startTime" });
    const res = await this.call<{ items?: { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string; htmlLink?: string }[] }>(`${CALENDAR}/events?${q}`, { token });
    return (res.items ?? []).map((e) => ({
      id: e.id,
      title: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? "",
      end: e.end?.dateTime ?? e.end?.date ?? "",
      allDay: !e.start?.dateTime,
      location: e.location ?? null,
      link: e.htmlLink ?? null,
    }));
  }

  async createEvent(token: string, input: { title: string; start: Date; end: Date; allDay: boolean; description: string | null; location: string | null }) {
    // An all-day event is a date range whose end date is the day after (Google's rule).
    const when = input.allDay ? { start: { date: dayOf(input.start) }, end: { date: dayOf(input.end) } } : { start: { dateTime: input.start.toISOString() }, end: { dateTime: input.end.toISOString() } };
    const res = await this.call<{ id: string; htmlLink?: string }>(`${CALENDAR}/events`, {
      method: "POST",
      token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: input.title, description: input.description ?? undefined, location: input.location ?? undefined, ...when }),
    });
    return { id: res.id, title: input.title, start: input.allDay ? dayOf(input.start) : input.start.toISOString(), end: input.allDay ? dayOf(input.end) : input.end.toISOString(), allDay: input.allDay, location: input.location, link: res.htmlLink ?? null };
  }
}

/* ───────────── A fake Google for development and tests ───────────── */

export class FakeGoogleProvider implements GoogleProvider {
  readonly name = "fake" as const;
  readonly sent: { to: string; subject: string; text: string }[] = [];
  refreshes = 0;
  /** How long a token lasts; tests shorten it to see a refresh. */
  tokenSeconds = 3600;
  inbox: Email[] = [
    { id: "m1", from: "Demo Post <orders@demo-post.example>", to: "owner@example.com", subject: "Order CJ-1001 has shipped", date: "Tue, 27 Oct 2026 09:12:00 +0000", snippet: "Your order CJ-1001 (Sunset Projection Lamp x2) shipped today.", text: "Hi,\n\nYour order CJ-1001 (Sunset Projection Lamp x2) shipped today with tracking DEMO123.\n\nDemo Post" },
    { id: "m2", from: "Ada Buyer <ada@example.com>", to: "owner@example.com", subject: "Wholesale prices?", date: "Mon, 26 Oct 2026 16:40:00 +0000", snippet: "Hi, I run a small gift shop and would like to stock your lamps. Do you offer wholesale prices?", text: "Hi, I run a small gift shop and would like to stock your lamps. Do you offer wholesale prices?\n\nAda" },
  ];
  events: CalendarEvent[] = [{ id: "e1", title: "Call with the lamp supplier", start: new Date(Date.now() + 86_400_000).toISOString(), end: new Date(Date.now() + 86_400_000 + 1_800_000).toISOString(), allDay: false, location: null, link: null }];

  authUrl({ state, redirectUri }: { state: string; redirectUri: string }) {
    // Straight back to the callback, as if the owner said yes.
    return `${redirectUri}?${new URLSearchParams({ code: "fake-code", state })}`;
  }
  async exchangeCode(code: string): Promise<GoogleTokens> {
    if (code !== "fake-code") throw new Error("Bad code");
    return { accessToken: `fake-access-${Date.now()}`, refreshToken: "fake-refresh", expiresAt: new Date(Date.now() + this.tokenSeconds * 1000), email: "owner@gmail.example", scopes: GOOGLE_SCOPES };
  }
  revoked: string[] = [];
  async revoke(token: string) {
    this.revoked.push(token);
  }
  async refresh(refreshToken: string) {
    if (refreshToken !== "fake-refresh") throw new Error("Bad refresh token");
    this.refreshes++;
    return { accessToken: `fake-access-${Date.now()}`, expiresAt: new Date(Date.now() + this.tokenSeconds * 1000) };
  }
  private check(token: string) {
    if (!token.startsWith("fake-access-")) throw new UserError("Google no longer accepts the connection. The owner needs to connect it again on the Connectors page.");
  }
  async listEmails(token: string, input: { query: string | null; max: number }) {
    this.check(token);
    const q = input.query?.toLowerCase().replace(/\b(from|subject|is|newer_than|in):\S+/g, "").trim();
    return this.inbox.filter((m) => !q || `${m.from} ${m.subject} ${m.text}`.toLowerCase().includes(q)).slice(0, input.max).map(({ text: _, to: __, ...s }) => s);
  }
  async getEmail(token: string, id: string) {
    this.check(token);
    return this.inbox.find((m) => m.id === id) ?? null;
  }
  async sendEmail(token: string, input: { to: string; subject: string; text: string }) {
    this.check(token);
    this.sent.push(input);
    return { id: `sent-${this.sent.length}` };
  }
  async listEvents(token: string, input: { from: Date; to: Date; max: number }) {
    this.check(token);
    return this.events.filter((e) => new Date(e.start) >= input.from && new Date(e.start) <= input.to).slice(0, input.max);
  }
  async createEvent(token: string, input: { title: string; start: Date; end: Date; allDay: boolean; description: string | null; location: string | null }) {
    this.check(token);
    const e = { id: `e${this.events.length + 1}`, title: input.title, start: input.allDay ? dayOf(input.start) : input.start.toISOString(), end: input.allDay ? dayOf(input.end) : input.end.toISOString(), allDay: input.allDay, location: input.location, link: null };
    this.events.push(e);
    return e;
  }
}

export function googleFromEnv(env: Record<string, string | undefined>): GoogleProvider {
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) return new RealGoogleProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  return new FakeGoogleProvider();
}

/* ───────────── Small helpers the tools share ───────────── */

/** "Tue 27 Oct, 09:12" from an RFC 2822 or ISO date, in the store's time zone; the text as is if it won't parse. */
export function whenLabel(date: string, timeZone: string) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  try {
    return d.toLocaleString("en-US", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone });
  } catch {
    return d.toISOString();
  }
}

/** The calendar date (UTC) of a moment, as 2026-11-15. */
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** A bare date like 2026-11-15 means the whole day. */
export const isAllDay = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text.trim());

/** A time like 2026-11-15T14:00+01:00 (UTC when no offset is given), or 2026-11-15 for a whole day (the start of that day, UTC). */
export function parseEventTime(text: string) {
  const t = text.trim();
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?)?(Z|[+-]\d{2}:\d{2})?$/.test(t)) throw new UserError("Give the time like 2026-11-15T14:00+01:00 (with the owner's time zone offset), or 2026-11-15 for a whole day.");
  const d = new Date(t.length === 10 ? `${t}T00:00:00Z` : /Z|[+-]\d{2}:\d{2}$/.test(t) ? t : `${t}Z`);
  if (Number.isNaN(d.getTime())) throw new UserError("That time doesn't exist.");
  return d;
}
