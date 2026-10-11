"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { confirmTwoStep, renewRecoveryCodes, startTwoStepSetup, turnOffTwoStep, UserError } from "@sf/core";
import { BRAND } from "@/lib/brand";
import { db, mailer, requireUser, SESSION_COOKIE } from "@/lib/server";

export type TwoStepState = { error?: string; codes?: string[]; off?: boolean };

const fail = (e: unknown): TwoStepState => {
  if (e instanceof UserError) return { error: e.message };
  throw e;
};

/** Makes a new secret for the person to scan; the page then shows it. */
export async function startTwoStepAction() {
  const user = await requireUser();
  try {
    await startTwoStepSetup(await db(), user.id, BRAND);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
  }
  revalidatePath("/admin/account");
}

/** Turns it on with a code from the app, signs out other devices and shows the recovery codes once. */
export async function confirmTwoStepAction(_: TwoStepState, form: FormData): Promise<TwoStepState> {
  const user = await requireUser();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    const { recoveryCodes } = await confirmTwoStep({ db: await db(), mailer: mailer(), brand: BRAND }, user.id, String(form.get("code") ?? ""), token);
    return { codes: recoveryCodes };
  } catch (e) {
    return fail(e);
  }
}

export async function renewCodesAction(_: TwoStepState, form: FormData): Promise<TwoStepState> {
  const user = await requireUser();
  try {
    const { recoveryCodes } = await renewRecoveryCodes(await db(), user.id, String(form.get("code") ?? ""));
    return { codes: recoveryCodes };
  } catch (e) {
    return fail(e);
  }
}

export async function turnOffTwoStepAction(_: TwoStepState, form: FormData): Promise<TwoStepState> {
  const user = await requireUser();
  try {
    await turnOffTwoStep({ db: await db(), mailer: mailer(), brand: BRAND }, user.id, { password: String(form.get("password") ?? ""), code: String(form.get("code") ?? "") });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin/account");
  return { off: true };
}
