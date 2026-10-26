"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cancelInvite, changeRole, inviteMember, removeMember, ROLES, transferOwnership, UserError, type Role } from "@sf/core";
import { BRAND } from "@/lib/brand";
import { adminUrl, logged, mailer, requireShop, SHOP_COOKIE } from "@/lib/server";
import type { FormState } from "./actions";

export type InviteFormState = FormState & { email?: string };

export async function inviteAction(_: InviteFormState, form: FormData): Promise<InviteFormState> {
  const { shop, db, user } = await requireShop("team");
  const email = String(form.get("email") ?? "");
  const base = await adminUrl("/invite/");
  try {
    const role = String(form.get("role") ?? "");
    await inviteMember({ db, mailer: mailer(), brand: BRAND, inviteUrl: (t) => `${base}${t}` }, shop, user, { email, role });
    await logged({ shop, user, db }, `Invited ${email.trim().toLowerCase()} as ${roleName(role)}`, { href: "/admin/team" });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, email };
    throw e;
  }
  revalidatePath("/admin/team");
  return { saved: true, email: email.trim().toLowerCase() };
}

export async function resendInviteAction(email: string, role: string) {
  const { shop, db, user } = await requireShop("team");
  const base = await adminUrl("/invite/");
  await inviteMember({ db, mailer: mailer(), brand: BRAND, inviteUrl: (t) => `${base}${t}` }, shop, user, { email, role });
  revalidatePath("/admin/team");
}

/** "admin" → "admin", for the activity log. */
const roleName = (role: string) => (role in ROLES ? ROLES[role as Role].name.toLowerCase() : role);

const memberEmail = async (db: Awaited<ReturnType<typeof requireShop>>["db"], userId: string) =>
  (await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, userId), columns: { email: true } }))?.email ?? "someone";

export async function cancelInviteAction(id: string) {
  const { shop, db, user } = await requireShop("team");
  const invite = await db.query.shopInvites.findFirst({ where: (i, { and, eq }) => and(eq(i.id, id), eq(i.shopId, shop.id)), columns: { email: true } });
  await cancelInvite(db, shop.id, id);
  if (invite) await logged({ shop, user, db }, `Cancelled the invite for ${invite.email}`, { href: "/admin/team" });
  revalidatePath("/admin/team");
}

export async function changeRoleAction(userId: string, form: FormData) {
  const { shop, db, user } = await requireShop("team");
  const role = String(form.get("role") ?? "");
  await changeRole(db, shop.id, userId, role);
  await logged({ shop, user, db }, `Made ${await memberEmail(db, userId)} ${roleName(role) === "admin" ? "an admin" : roleName(role)}`, { href: "/admin/team" });
  revalidatePath("/admin/team");
}

export async function removeMemberAction(userId: string) {
  const { shop, db, user } = await requireShop("team");
  const email = await memberEmail(db, userId);
  await removeMember(db, shop.id, userId);
  await logged({ shop, user, db }, `Removed ${email} from the team`, { href: "/admin/team" });
  revalidatePath("/admin/team");
}

export async function transferOwnershipAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db, user } = await requireShop("team");
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm. You'll become an admin and can't undo this yourself." };
  try {
    const to = String(form.get("userId") ?? "");
    await transferOwnership(db, shop.id, user.id, to);
    await logged({ shop, user, db }, `Handed the store over to ${await memberEmail(db, to)}`, { href: "/admin/team" });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin", "layout");
  redirect("/admin/team?handed=1");
}

/** Anyone but the owner can leave a store they help run. */
export async function leaveStoreAction() {
  const { shop, db, user } = await requireShop();
  await removeMember(db, shop.id, user.id);
  await logged({ shop, user, db }, "Left the team", { href: "/admin/team" });
  (await cookies()).delete(SHOP_COOKIE);
  redirect("/admin");
}
