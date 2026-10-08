"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, deleteSession, requestPasswordReset, resetPassword, signIn, signUp, UserError } from "@sf/core";
import { BRAND } from "@/lib/brand";
import { adminUrl, db, mailer, SESSION_COOKIE } from "@/lib/server";

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

export async function signUpAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "");
  try {
    const user = await signUp(await db(), { email, password: String(form.get("password") ?? "") });
    await startSession(user.id);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, email };
    throw e;
  }
  redirect("/admin/new-store");
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
  redirect("/admin");
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
