"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, deleteSession, signIn, signUp, UserError } from "@sf/core";
import { db, SESSION_COOKIE } from "@/lib/server";

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
