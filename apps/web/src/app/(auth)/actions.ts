"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInvite, createSession, deleteSession, finishTwoStep, requestPasswordReset, resetPassword, signIn, signUp, twoStepChallenge, UserError } from "@sf/core";
import { BRAND } from "@/lib/brand";
import { adminUrl, db, mailer, requireUser, SESSION_COOKIE, SHOP_COOKIE, TWO_STEP_COOKIE } from "@/lib/server";

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

/**
 * After the right password: signs in, or, with two-step sign-in on, keeps the step in a short-lived
 * cookie and returns the page that asks for the code.
 */
async function passwordAccepted(userId: string, next: string | null) {
  const challenge = await twoStepChallenge(await db(), userId);
  if (!challenge) {
    await startSession(userId);
    return null;
  }
  (await cookies()).set(TWO_STEP_COOKIE, challenge, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return next ? `/login/code?next=${encodeURIComponent(next)}` : "/login/code";
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
  let codeStep: string | null;
  try {
    const user = await signIn(await db(), { email, password: String(form.get("password") ?? "") });
    codeStep = await passwordAccepted(user.id, nextPath(form));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, email };
    throw e;
  }
  redirect(codeStep ?? nextPath(form) ?? "/admin");
}

export type CodeState = { error?: string; expired?: boolean };

export async function twoStepAction(_: CodeState, form: FormData): Promise<CodeState> {
  const jar = await cookies();
  const challenge = jar.get(TWO_STEP_COOKIE)?.value;
  if (!challenge) return { error: "That took too long. Sign in again.", expired: true };
  let left: number | null;
  try {
    const user = await finishTwoStep({ db: await db(), mailer: mailer(), brand: BRAND }, challenge, String(form.get("code") ?? ""));
    left = user.recoveryCodesLeft;
    jar.delete(TWO_STEP_COOKIE);
    await startSession(user.id);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, expired: e.code === "expired" };
    throw e;
  }
  // Someone who used a recovery code is likely on a new phone: take them to set it up again.
  redirect(left !== null ? "/admin/account?recovered=1" : nextPath(form) ?? "/admin");
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
  let codeStep: string | null;
  try {
    const user = await resetPassword(await db(), token, String(form.get("password") ?? ""));
    codeStep = await passwordAccepted(user.id, null);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  // A new password doesn't skip two-step sign-in.
  redirect(codeStep ?? "/admin");
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
