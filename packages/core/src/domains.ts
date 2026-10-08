import { resolve4, resolveCname } from "node:dns/promises";
import { domainToASCII } from "node:url";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

/*
 * Custom domains: a merchant points a domain they already own at us, we check the DNS
 * records, and once they are right the store answers on that domain. The hosting platform
 * (Vercel) issues the certificate; DomainHost is the seam to it.
 */

export type DomainCheck = { ok: true } | { ok: false; problem: string };

export interface DomainHost {
  readonly name: string;
  /** Asks the hosting platform to serve this hostname and issue its certificate. */
  attach(hostname: string): Promise<void>;
  detach(hostname: string): Promise<void>;
  check(hostname: string): Promise<DomainCheck>;
}

/** Where merchants point their DNS. Defaults are Vercel's documented values. */
export type DnsTargets = { aRecord: string; cname: string };
export const DEFAULT_DNS_TARGETS: DnsTargets = { aRecord: "76.76.21.21", cname: "cname.vercel-dns.com" };

export type DnsRecord = { type: "A" | "CNAME"; name: string; value: string };

// Two-part endings in our launch countries, so shop.co.uk counts as a root domain.
const TWO_PART_SUFFIXES = new Set(["co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "com.es", "org.es", "co.at", "or.at", "com.pl", "com.cy", "com.mt", "com.gr", "com.pt", "co.hu", "com.hr"]);

export function isApex(hostname: string) {
  const labels = hostname.split(".");
  if (labels.length === 2) return true;
  return labels.length === 3 && TWO_PART_SUFFIXES.has(labels.slice(1).join("."));
}

export function dnsRecordsFor(hostname: string, targets: DnsTargets = DEFAULT_DNS_TARGETS): DnsRecord[] {
  if (isApex(hostname)) return [{ type: "A", name: "@", value: targets.aRecord }];
  const apexLabels = TWO_PART_SUFFIXES.has(hostname.split(".").slice(-2).join(".")) ? 3 : 2;
  const name = hostname.split(".").slice(0, -apexLabels).join(".");
  return [{ type: "CNAME", name, value: targets.cname }];
}

/**
 * Turns what a merchant types ("https://Shop.Example.com/", "www.example.com") into a hostname.
 * Platform hosts are refused: those already belong to us.
 */
export function normalizeHostname(input: string, platformHosts: string[] = []): string {
  let raw = input.trim().toLowerCase();
  raw = raw.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0]!.replace(/:\d+$/, "").replace(/\.$/, "");
  const host = domainToASCII(raw);
  const labels = host.split(".");
  const valid =
    host.length <= 253 &&
    labels.length >= 2 &&
    labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) &&
    /^[a-z]{2,}$|^xn--/.test(labels.at(-1)!);
  if (!valid) throw new UserError("Enter a domain like shop.example.com.");
  const blocked = ["vercel.app", "localhost", ...platformHosts.map((h) => h.toLowerCase().replace(/:\d+$/, ""))];
  if (blocked.some((b) => host === b || host.endsWith(`.${b}`))) {
    throw new UserError("That address already belongs to the platform. Enter a domain you own.");
  }
  return host;
}

/** Checks the public DNS records directly. Used when no hosting API is configured. */
export class DnsDomainHost implements DomainHost {
  readonly name = "dns";
  constructor(
    private targets: DnsTargets = DEFAULT_DNS_TARGETS,
    private lookup = { resolve4, resolveCname },
  ) {}
  async attach() {}
  async detach() {}
  async check(hostname: string): Promise<DomainCheck> {
    const want = dnsRecordsFor(hostname, this.targets)[0]!;
    try {
      if (want.type === "CNAME") {
        const cnames = await this.lookup.resolveCname(hostname).catch(() => [] as string[]);
        if (cnames.some((c) => c.toLowerCase().replace(/\.$/, "") === this.targets.cname)) return { ok: true };
      }
      const ips = await this.lookup.resolve4(hostname).catch(() => [] as string[]);
      if (ips.includes(this.targets.aRecord)) return { ok: true };
      if (!ips.length) return { ok: false, problem: `We can't find any DNS record for ${hostname} yet.` };
      return { ok: false, problem: `${hostname} points to ${ips.join(", ")}, not to us yet.` };
    } catch {
      return { ok: false, problem: "We couldn't look up that domain. Try again in a few minutes." };
    }
  }
}

/** Vercel's project domains API: attaches the domain and reports when DNS and SSL are ready. */
export class VercelDomainHost implements DomainHost {
  readonly name = "vercel";
  constructor(
    private opts: { token: string; projectId: string; teamId?: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(method: string, path: string, body?: unknown) {
    const url = new URL(`https://api.vercel.com${path}`);
    if (this.opts.teamId) url.searchParams.set("teamId", this.opts.teamId);
    const res = await this.fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${this.opts.token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    return { status: res.status, json };
  }

  async attach(hostname: string) {
    const { status, json } = await this.call("POST", `/v10/projects/${this.opts.projectId}/domains`, { name: hostname });
    if (status < 300 || json.error?.code === "domain_already_in_use_by_project") return;
    if (json.error?.code === "domain_already_in_use") {
      throw new UserError("That domain is connected to another website. Remove it there first, then try again.");
    }
    throw new UserError(json.error?.message ?? "We couldn't connect that domain. Try again in a few minutes.");
  }

  async detach(hostname: string) {
    await this.call("DELETE", `/v9/projects/${this.opts.projectId}/domains/${hostname}`);
  }

  async check(hostname: string): Promise<DomainCheck> {
    const project = await this.call("GET", `/v9/projects/${this.opts.projectId}/domains/${hostname}`);
    if (project.status === 404) return { ok: false, problem: "This domain isn't attached yet. Remove it and add it again." };
    if (project.json.verified === false) {
      const txt = (project.json.verification ?? [])[0];
      return {
        ok: false,
        problem: txt
          ? `Add a ${txt.type} record named ${txt.domain} with the value ${txt.value} to prove you own it.`
          : "We're still confirming you own this domain.",
      };
    }
    const config = await this.call("GET", `/v6/domains/${hostname}/config`);
    if (config.json.misconfigured) return { ok: false, problem: "The DNS records aren't pointing to us yet." };
    return { ok: true };
  }
}

export function dnsTargetsFromEnv(env: Record<string, string | undefined>): DnsTargets {
  return { aRecord: env.DOMAIN_A_RECORD || DEFAULT_DNS_TARGETS.aRecord, cname: env.DOMAIN_CNAME_TARGET || DEFAULT_DNS_TARGETS.cname };
}

/** Accepts every domain without looking it up. For automated tests only; never in production. */
export class UncheckedDomainHost implements DomainHost {
  readonly name = "unchecked";
  async attach() {}
  async detach() {}
  async check(): Promise<DomainCheck> {
    return { ok: true };
  }
}

export function domainHostFromEnv(env: Record<string, string | undefined>): DomainHost {
  if (env.DOMAIN_CHECKS === "off") {
    console.warn("DOMAIN_CHECKS=off: custom domains connect without a DNS check. Test use only.");
    return new UncheckedDomainHost();
  }
  const targets = dnsTargetsFromEnv(env);
  if (env.VERCEL_API_TOKEN && env.VERCEL_PROJECT_ID) {
    return new VercelDomainHost({ token: env.VERCEL_API_TOKEN, projectId: env.VERCEL_PROJECT_ID, teamId: env.VERCEL_TEAM_ID || undefined });
  }
  return new DnsDomainHost(targets);
}

export type DomainContext = { db: Db; host: DomainHost; platformHosts: string[]; targets?: DnsTargets; now?: () => Date };

export async function listDomains(db: Db, shopId: string) {
  return db.query.domains.findMany({ where: eq(schema.domains.shopId, shopId), orderBy: asc(schema.domains.createdAt) });
}

export async function addDomain(ctx: DomainContext, shopId: string, input: string) {
  const hostname = normalizeHostname(input, ctx.platformHosts);
  const taken = await ctx.db.query.domains.findFirst({ where: eq(schema.domains.hostname, hostname), columns: { shopId: true } });
  if (taken) {
    throw new UserError(taken.shopId === shopId ? "That domain is already on your list." : "That domain is already used by another store.");
  }
  await ctx.host.attach(hostname);
  const [row] = await ctx.db.insert(schema.domains).values({ shopId, hostname }).returning();
  return row!;
}

async function ownDomain(db: Db, shopId: string, domainId: string) {
  const row = await db.query.domains.findFirst({ where: and(eq(schema.domains.id, domainId), eq(schema.domains.shopId, shopId)) });
  if (!row) throw new NotFoundError("Domain");
  return row;
}

/** Re-checks DNS. The first domain that passes becomes the store's main address. */
export async function checkDomain(ctx: DomainContext, shopId: string, domainId: string) {
  const row = await ownDomain(ctx.db, shopId, domainId);
  const now = ctx.now?.() ?? new Date();
  const result = await ctx.host.check(row.hostname);
  if (!result.ok) {
    // A domain that worked and then broke keeps serving until the merchant removes it;
    // the error tells them what changed.
    await ctx.db.update(schema.domains).set({ lastCheckedAt: now, lastError: result.problem }).where(eq(schema.domains.id, row.id));
    return { ...row, lastCheckedAt: now, lastError: result.problem };
  }
  const hasPrimary = await ctx.db.query.domains.findFirst({
    where: and(eq(schema.domains.shopId, shopId), eq(schema.domains.isPrimary, true)),
    columns: { id: true },
  });
  const [updated] = await ctx.db
    .update(schema.domains)
    .set({ verifiedAt: row.verifiedAt ?? now, lastCheckedAt: now, lastError: null, isPrimary: row.isPrimary || !hasPrimary })
    .where(eq(schema.domains.id, row.id))
    .returning();
  return updated!;
}

export async function setPrimaryDomain(db: Db, shopId: string, domainId: string) {
  const row = await ownDomain(db, shopId, domainId);
  if (!row.verifiedAt) throw new UserError("Finish connecting this domain before making it your main address.");
  await db.transaction(async (tx) => {
    await tx.update(schema.domains).set({ isPrimary: false }).where(eq(schema.domains.shopId, shopId));
    await tx.update(schema.domains).set({ isPrimary: true }).where(eq(schema.domains.id, row.id));
  });
}

export async function removeDomain(ctx: DomainContext, shopId: string, domainId: string) {
  const row = await ownDomain(ctx.db, shopId, domainId);
  await ctx.host.detach(row.hostname);
  await ctx.db.delete(schema.domains).where(eq(schema.domains.id, row.id));
  if (row.isPrimary) {
    const next = await ctx.db.query.domains.findFirst({
      where: and(eq(schema.domains.shopId, shopId), isNotNull(schema.domains.verifiedAt)),
      orderBy: asc(schema.domains.createdAt),
    });
    if (next) await ctx.db.update(schema.domains).set({ isPrimary: true }).where(eq(schema.domains.id, next.id));
  }
}

/** The store a verified custom domain belongs to, or null. */
export async function getShopByHostname(db: Db, hostname: string) {
  const host = hostname.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const row = await db
    .select({ shop: schema.shops })
    .from(schema.domains)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.domains.shopId))
    .where(and(eq(schema.domains.hostname, host), isNotNull(schema.domains.verifiedAt)))
    .limit(1);
  return row[0]?.shop ?? null;
}

export async function primaryDomain(db: Db, shopId: string) {
  const row = await db.query.domains.findFirst({
    where: and(eq(schema.domains.shopId, shopId), eq(schema.domains.isPrimary, true), isNotNull(schema.domains.verifiedAt)),
    columns: { hostname: true },
  });
  return row?.hostname ?? null;
}
