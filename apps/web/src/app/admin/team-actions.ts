"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cancelInvite, changeRole, inviteMember, removeMember, transferOwnership, UserError } from "@sf/core";
import { BRAND } from "@/lib/brand";
import { adminUrl, mailer, requireShop, SHOP_COOKIE } from "@/lib/server";
import type { FormState } from "./actions";

export type InviteFormState = FormState & { email?: string };

export async function inviteAction(_: InviteFormState, form: FormData): Promise<InviteFormState> {
  const { shop, db, user } = await requireShop("team");
  const email = String(form.get("email") ?? "");
  const base = await adminUrl("/invite/");
  try {
    await inviteMember({ db, mailer: mailer(), brand: BRAND, inviteUrl: (t) => `${base}${t}` }, shop, user, { email, role: String(form.get("role") ?? "") });
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

export async function cancelInviteAction(id: string) {
  const { shop, db } = await requireShop("team");
  await cancelInvite(db, shop.id, id);
  revalidatePath("/admin/team");
}

export async function changeRoleAction(userId: string, form: FormData) {
  const { shop, db } = await requireShop("team");
  await changeRole(db, shop.id, userId, String(form.get("role") ?? ""));
  revalidatePath("/admin/team");
}

export async function removeMemberAction(userId: string) {
  const { shop, db } = await requireShop("team");
  await removeMember(db, shop.id, userId);
  revalidatePath("/admin/team");
}

export async function transferOwnershipAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db, user } = await requireShop("team");
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm. You'll become an admin and can't undo this yourself." };
  try {
    await transferOwnership(db, shop.id, user.id, String(form.get("userId") ?? ""));
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
  (await cookies()).delete(SHOP_COOKIE);
  redirect("/admin");
}
