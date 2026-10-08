"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInvite, createSession, deleteSession, requestPasswordReset, resetPassword, signIn, signUp, UserError } from "@sf/core";
import { BRAND } from "@/lib/brand";
import { adminUrl, db, mailer, requireUser, SESSION_COOKIE, SHOP_COOKIE } from "@/lib/server";

export type AuthState = { error?: string; email?: string };

async function startSession(userId: string) {
  const { token, expiresAt } = await createSession(await db(), userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Only invite links are followed after signing in, so the form can't send people elsewhere. */
function nextPath(form: FormData) {
  const next = String(form.get("next") ?? "");
  return /^\/invite\/[\w-]+$/.test(next) ? next : null;
}

export async function signUpAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "");
  try {
    const user = await signUp(await db(), { email, password: String(form.get("password") ?? "") });
    await startSession(user.id);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, email };
    throw e;
  }
  redirect(nextPath(form) ?? "/admin/new-store");
}

export async function signInAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "");
  try {
    const user = await signIn(await db(), { email, password: String(form.get("password") ?? "") });
    await startSession(user.id);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, email };
    throw e;
  }
  redirect(nextPath(form) ?? "/admin");
}

export async function signOutAction() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(await db(), token);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export type ResetState = { error?: string; sent?: boolean; email?: string };

export async function forgotPasswordAction(_: ResetState, form: FormData): Promise<ResetState> {
  const email = String(form.get("email") ?? "");
  const base = await adminUrl("/reset/");
  try {
    await requestPasswordReset({ db: await db(), mailer: mailer(), brand: BRAND, resetUrl: (t) => `${base}${t}` }, email);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, email };
    throw e;
  }
  // The same answer whether or not the email has an account.
  return { sent: true, email };
}

export async function resetPasswordAction(token: string, _: ResetState, form: FormData): Promise<ResetState> {
  try {
    const user = await resetPassword(await db(), token, String(form.get("password") ?? ""));
    await startSession(user.id);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect("/admin");
}

export type InviteState = { error?: string };

export async function acceptInviteAction(token: string, _: InviteState, _form: FormData): Promise<InviteState> {
  const user = await requireUser();
  let shopId: string;
  try {
    ({ shopId } = await acceptInvite(await db(), token, user));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  (await cookies()).set(SHOP_COOKIE, shopId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/admin");
}
