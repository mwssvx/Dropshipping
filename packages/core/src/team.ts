// People who help run a store: roles, what each role can open, and invites by email.
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import type { Mailer } from "./email";
import { NotFoundError, UserError } from "./errors";
import { PLANS, type PlanId } from "./plans";

export type Role = (typeof schema.shopMembers.$inferSelect)["role"];

/** Parts of the admin a role can be allowed into. "refunds" and "payouts" guard single actions. */
export const AREAS = [
  "home", "analytics", "assistant", "orders", "refunds", "customers", "inbox", "money", "payouts", "products", "collections",
  "suppliers", "marketing", "reviews", "theme", "pages", "domains", "trust", "plan", "ai", "taxes", "currencies", "developers",
  "export", "team", "wholesale", "gift_cards", "shipping", "returns",
] as const;
export type Area = (typeof AREAS)[number];

const STAFF: readonly Area[] = ["home", "orders", "customers", "inbox", "products", "collections", "reviews"];
const OWNER_ONLY: readonly Area[] = ["plan", "payouts", "team", "developers", "export"];

export const ROLES: Record<Role, { name: string; summary: string }> = {
  owner: { name: "Owner", summary: "Everything, including the plan, payouts, the team, API keys and exporting the store." },
  admin: { name: "Admin", summary: "Runs the store day to day: orders and refunds, products, the online store, money, marketing and settings. Not the plan, payouts, team, API keys or export." },
  staff: { name: "Staff", summary: "Orders (without refunds), customers, buyer messages, products, collections and reviews. No money, sales totals or settings." },
};

export function can(role: Role, area: Area): boolean {
  if (role === "owner") return true;
  if (role === "admin") return !OWNER_ONLY.includes(area);
  return STAFF.includes(area);
}

const DAY = 86_400_000;
const INVITE_DAYS = 7;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function teamSeats(plan: PlanId) {
  return PLANS[plan].teamSeats;
}

export async function listTeam(db: Db, shopId: string, now = new Date()) {
  const members = await db
    .select({ userId: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.shopMembers.role, since: schema.shopMembers.createdAt })
    .from(schema.shopMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.shopMembers.userId))
    .where(eq(schema.shopMembers.shopId, shopId))
    .orderBy(asc(schema.shopMembers.createdAt));
  const invites = await db.query.shopInvites.findMany({
    where: and(eq(schema.shopInvites.shopId, shopId), isNull(schema.shopInvites.acceptedAt), gt(schema.shopInvites.expiresAt, now)),
    orderBy: asc(schema.shopInvites.createdAt),
    columns: { tokenHash: false },
  });
  const order: Record<Role, number> = { owner: 0, admin: 1, staff: 2 };
  members.sort((a, b) => order[a.role] - order[b.role]);
  return { members, invites };
}

/** Seats taken: everyone but the owner, plus invites not yet answered. */
async function seatsUsed(db: Db, shopId: string, now: Date) {
  const { members, invites } = await listTeam(db, shopId, now);
  return members.filter((m) => m.role !== "owner").length + invites.length;
}

const inviteInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(["admin", "staff"], { errorMap: () => ({ message: "Choose Admin or Staff." }) }),
});

export type InviteContext = { db: Db; mailer: Mailer; brand: string; inviteUrl: (token: string) => string };

/**
 * Emails a link to join the store, valid for a week. Inviting the same email again replaces the
 * old link. The plan sets how many people besides the owner can join.
 */
export async function inviteMember(
  ctx: InviteContext,
  shop: { id: string; name: string; plan: PlanId },
  invitedBy: { id: string; email: string },
  input: { email: string; role: string },
  now = new Date(),
) {
  const parsed = inviteInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { email, role } = parsed.data;
  const { members, invites } = await listTeam(ctx.db, shop.id, now);
  if (members.some((m) => m.email === email)) throw new UserError(`${email} is already on the team.`, "exists");
  const seats = teamSeats(shop.plan);
  const replacing = invites.find((i) => i.email === email);
  const used = members.filter((m) => m.role !== "owner").length + invites.length - (replacing ? 1 : 0);
  if (seats === 0) throw new UserError(`Your ${PLANS[shop.plan].name} plan doesn't include staff accounts. Scale includes ${PLANS.scale.teamSeats}.`, "plan");
  if (used >= seats) throw new UserError(`Your plan includes ${seats} people besides you, and they're all taken. Remove someone or cancel an invite first.`, "seats");

  const token = randomBytes(32).toString("base64url");
  await ctx.db.transaction(async (tx) => {
    if (replacing) await tx.delete(schema.shopInvites).where(eq(schema.shopInvites.id, replacing.id));
    await tx.insert(schema.shopInvites).values({ shopId: shop.id, email, role, tokenHash: hashToken(token), invitedBy: invitedBy.id, expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY), createdAt: now });
  });
  await ctx.mailer.send({
    to: email,
    replyTo: invitedBy.email,
    subject: `Join ${shop.name} on ${ctx.brand}`,
    text: [
      `${invitedBy.email} invited you to help run ${shop.name} on ${ctx.brand} as ${ROLES[role].name.toLowerCase()}.`,
      "",
      `${ROLES[role].name}: ${ROLES[role].summary}`,
      "",
      "Join here within a week. Sign in or create an account with this email address:",
      ctx.inviteUrl(token),
      "",
      "If you weren't expecting this, ignore this email.",
    ].join("\n"),
  });
}

/** What an invite link is for, so the page can explain it before anyone signs in. */
export async function getInvite(db: Db, token: string, now = new Date()) {
  const invite = await db.query.shopInvites.findFirst({ where: eq(schema.shopInvites.tokenHash, hashToken(token)) });
  if (!invite) return null;
  const shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, invite.shopId), columns: { id: true, name: true } }))!;
  const status = invite.acceptedAt ? "accepted" : invite.expiresAt <= now ? "expired" : "open";
  return { email: invite.email, role: invite.role, shop, status } as const;
}

/** Joins the signed-in person to the store. They must be signed in with the invited email. */
export async function acceptInvite(db: Db, token: string, user: { id: string; email: string }, now = new Date()) {
  const invite = await db.query.shopInvites.findFirst({ where: eq(schema.shopInvites.tokenHash, hashToken(token)) });
  if (!invite || invite.acceptedAt || invite.expiresAt <= now) throw new UserError("This invite has expired or was already used. Ask for a new one.", "expired");
  if (invite.email !== user.email.toLowerCase()) throw new UserError(`This invite is for ${invite.email}. Sign in with that email to accept it.`, "wrong_email");
  await db.transaction(async (tx) => {
    await tx.update(schema.shopInvites).set({ acceptedAt: now }).where(eq(schema.shopInvites.id, invite.id));
    await tx.insert(schema.shopMembers).values({ shopId: invite.shopId, userId: user.id, role: invite.role, createdAt: now }).onConflictDoNothing();
  });
  return { shopId: invite.shopId };
}

export async function cancelInvite(db: Db, shopId: string, inviteId: string) {
  await db.delete(schema.shopInvites).where(and(eq(schema.shopInvites.shopId, shopId), eq(schema.shopInvites.id, inviteId), isNull(schema.shopInvites.acceptedAt)));
}

async function memberRow(db: Db, shopId: string, userId: string) {
  const row = await db.query.shopMembers.findFirst({ where: and(eq(schema.shopMembers.shopId, shopId), eq(schema.shopMembers.userId, userId)) });
  if (!row) throw new NotFoundError("Team member");
  return row;
}

export async function changeRole(db: Db, shopId: string, userId: string, role: string) {
  if (role !== "admin" && role !== "staff") throw new UserError("Choose Admin or Staff.");
  const row = await memberRow(db, shopId, userId);
  if (row.role === "owner") throw new UserError("The owner's role can't change. Hand over ownership instead.");
  await db.update(schema.shopMembers).set({ role }).where(and(eq(schema.shopMembers.shopId, shopId), eq(schema.shopMembers.userId, userId)));
}

/** The owner removes someone, or a member leaves. The owner can't leave their own store. */
export async function removeMember(db: Db, shopId: string, userId: string) {
  const row = await memberRow(db, shopId, userId);
  if (row.role === "owner") throw new UserError("The owner can't be removed. Hand over ownership first.");
  await db.delete(schema.shopMembers).where(and(eq(schema.shopMembers.shopId, shopId), eq(schema.shopMembers.userId, userId)));
}

/** Makes a team member the owner. The old owner stays on as an admin. */
export async function transferOwnership(db: Db, shopId: string, fromUserId: string, toUserId: string) {
  if (fromUserId === toUserId) throw new UserError("You're already the owner.");
  const from = await memberRow(db, shopId, fromUserId);
  if (from.role !== "owner") throw new UserError("Only the owner can hand over the store.");
  await memberRow(db, shopId, toUserId);
  await db.transaction(async (tx) => {
    await tx.update(schema.shopMembers).set({ role: "admin" }).where(and(eq(schema.shopMembers.shopId, shopId), eq(schema.shopMembers.userId, fromUserId)));
    await tx.update(schema.shopMembers).set({ role: "owner" }).where(and(eq(schema.shopMembers.shopId, shopId), eq(schema.shopMembers.userId, toUserId)));
  });
}

/** For plan changes: a plan with fewer seats than people on the team can't be chosen. */
export async function assertSeatsFit(db: Db, shopId: string, plan: PlanId, now = new Date()) {
  const used = await seatsUsed(db, shopId, now);
  const seats = teamSeats(plan);
  if (used > seats) {
    throw new UserError(
      seats === 0
        ? `${PLANS[plan].name} doesn't include staff accounts. Remove the ${used} ${used === 1 ? "person" : "people"} on your team (and any open invites) first.`
        : `${PLANS[plan].name} includes ${seats} people besides you and your team has ${used}. Remove some first.`,
      "seats",
    );
  }
}

/** Invites that ran out over a month ago are dropped by the scheduled job. */
export async function pruneInvites(db: Db, now = new Date()) {
  await db.delete(schema.shopInvites).where(and(isNull(schema.shopInvites.acceptedAt), lt(schema.shopInvites.expiresAt, new Date(now.getTime() - 30 * DAY))));
}
