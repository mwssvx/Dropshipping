import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, schema } from "@sf/db";
import {
  acceptInvite, can, cancelInvite, changePlan, changeRole, createShop, FakePaymentProvider, getInvite, inviteMember, listShopsForUser, listTeam,
  LogMailer, removeMember, signUp, todaySummary, transferOwnership,
} from "../src";

async function setup(plan: "free" | "scale" = "scale") {
  const db = await createTestDb();
  const owner = await signUp(db, { email: "owner@example.com", password: "correct horse" });
  let shop = await createShop(db, owner.id, { name: "Lumen", country: "US" });
  await db.update(schema.shops).set({ plan }).where(eq(schema.shops.id, shop.id));
  shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, shop.id) }))!;
  const mailer = new LogMailer(true);
  const ctx = { db, mailer, brand: "Storefront", inviteUrl: (t: string) => `https://storefront.test/invite/${t}` };
  const tokenOf = (i: number) => mailer.sent[i]!.text.match(/invite\/(\S+)/)![1]!;
  return { db, owner, shop, mailer, ctx, tokenOf };
}

describe("roles", () => {
  it("lets each role into its own parts of the store", () => {
    expect(can("owner", "plan")).toBe(true);
    expect(can("admin", "refunds")).toBe(true);
    expect(can("admin", "money")).toBe(true);
    for (const area of ["plan", "payouts", "team", "developers", "export"] as const) expect(can("admin", area)).toBe(false);
    expect(can("staff", "orders")).toBe(true);
    expect(can("staff", "products")).toBe(true);
    for (const area of ["money", "refunds", "assistant", "analytics", "theme", "trust", "plan"] as const) expect(can("staff", area)).toBe(false);
  });
});

describe("team invites", () => {
  it("invites by email, and only that email can accept", async () => {
    const { db, owner, shop, mailer, ctx, tokenOf } = await setup();
    await inviteMember(ctx, shop, owner, { email: " Sam@Example.com ", role: "staff" });
    expect(mailer.sent[0]).toMatchObject({ to: "sam@example.com", subject: "Join Lumen on Storefront", replyTo: "owner@example.com" });
    const token = tokenOf(0);
    expect(await getInvite(db, token)).toMatchObject({ email: "sam@example.com", role: "staff", status: "open", shop: { name: "Lumen" } });

    const other = await signUp(db, { email: "other@example.com", password: "correct horse" });
    await expect(acceptInvite(db, token, other)).rejects.toThrow("This invite is for sam@example.com");
    const sam = await signUp(db, { email: "sam@example.com", password: "correct horse" });
    expect(await acceptInvite(db, token, sam)).toEqual({ shopId: shop.id });
    expect(await listShopsForUser(db, sam.id)).toEqual([expect.objectContaining({ id: shop.id, role: "staff" })]);
    await expect(acceptInvite(db, token, sam)).rejects.toThrow("expired or was already used");
    expect((await getInvite(db, token))!.status).toBe("accepted");

    await expect(inviteMember(ctx, shop, owner, { email: "sam@example.com", role: "admin" })).rejects.toThrow("already on the team");
  });

  it("expires links after a week, and a new invite replaces the old link", async () => {
    const { db, owner, shop, ctx, tokenOf } = await setup();
    await inviteMember(ctx, shop, owner, { email: "sam@example.com", role: "staff" });
    await inviteMember(ctx, shop, owner, { email: "sam@example.com", role: "admin" });
    const { invites } = await listTeam(db, shop.id);
    expect(invites).toEqual([expect.objectContaining({ email: "sam@example.com", role: "admin" })]);
    expect(await getInvite(db, tokenOf(0))).toBeNull();
    const sam = await signUp(db, { email: "sam@example.com", password: "correct horse" });
    await expect(acceptInvite(db, tokenOf(1), sam, new Date(Date.now() + 8 * 86_400_000))).rejects.toThrow("expired");
    await cancelInvite(db, shop.id, invites[0]!.id);
    await expect(acceptInvite(db, tokenOf(1), sam)).rejects.toThrow("expired or was already used");
  });

  it("follows the plan's staff seats, and a plan the team doesn't fit can't be chosen", async () => {
    const free = await setup("free");
    await expect(inviteMember(free.ctx, free.shop, free.owner, { email: "sam@example.com", role: "staff" })).rejects.toThrow("doesn't include staff accounts");

    const { db, owner, shop, ctx } = await setup("scale");
    for (let i = 0; i < 15; i++) await inviteMember(ctx, shop, owner, { email: `p${i}@example.com`, role: "staff" });
    await expect(inviteMember(ctx, shop, owner, { email: "one-more@example.com", role: "staff" })).rejects.toThrow("all taken");
    await expect(changePlan(db, new FakePaymentProvider(), shop, { plan: "growth", email: "owner@example.com", returnUrl: "https://x" })).rejects.toThrow("Remove the 15 people");
  });

  it("changes roles, removes people and hands over ownership", async () => {
    const { db, owner, shop, ctx, tokenOf } = await setup();
    await inviteMember(ctx, shop, owner, { email: "sam@example.com", role: "staff" });
    const sam = await signUp(db, { email: "sam@example.com", password: "correct horse" });
    await acceptInvite(db, tokenOf(0), sam);

    await changeRole(db, shop.id, sam.id, "admin");
    await expect(changeRole(db, shop.id, owner.id, "staff")).rejects.toThrow("owner's role can't change");
    await expect(removeMember(db, shop.id, owner.id)).rejects.toThrow("owner can't be removed");
    await expect(transferOwnership(db, shop.id, sam.id, owner.id)).rejects.toThrow("Only the owner");

    await transferOwnership(db, shop.id, owner.id, sam.id);
    const { members } = await listTeam(db, shop.id);
    expect(members.map((m) => [m.email, m.role])).toEqual([["sam@example.com", "owner"], ["owner@example.com", "admin"]]);

    await removeMember(db, shop.id, owner.id);
    expect(await listShopsForUser(db, owner.id)).toEqual([]);
  });
});

describe("what staff see in the app", () => {
  it("leaves out sales totals and AI proposals", async () => {
    const { db, shop } = await setup();
    const owner = await todaySummary(db, shop);
    expect(owner.salesTodayMinor).toBe(0);
    const staff = await todaySummary(db, shop, new Date(), "staff");
    expect(staff).toMatchObject({ salesTodayMinor: null, sales7dMinor: null, pending: [] });
    expect(staff.ordersToday).toBe(0);
  });
});
