"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  cancelScheduledCampaign, createCampaign, deleteCampaign, duplicateCampaign, sendCampaignBatches, sendTestCampaign, setMailingAddress, startCampaign,
  updateCampaign, UserError, type CampaignInput,
} from "@sf/core";
import type { CampaignAudience } from "@sf/db";
import { campaigns, requireShop } from "@/lib/server";
import type { FormState } from "./actions";

function readCampaign(form: FormData): CampaignInput {
  return {
    subject: String(form.get("subject") ?? ""),
    body: String(form.get("body") ?? ""),
    buttonLabel: String(form.get("buttonLabel") ?? ""),
    buttonPath: String(form.get("buttonPath") ?? ""),
    audience: String(form.get("audience") ?? "subscribers") as CampaignAudience,
  };
}

/** Saves a draft; a new one opens on its own page, where it can be tested and sent. */
export async function saveCampaignAction(id: string | null, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db, user } = await requireShop("marketing");
  let created: string | null = null;
  try {
    if (id) await updateCampaign(db, shop.id, id, readCampaign(form));
    else created = (await createCampaign(db, shop.id, user.id, readCampaign(form))).id;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  if (created) redirect(`/admin/campaigns/${created}?saved=1`);
  revalidatePath(`/admin/campaigns/${id}`);
  return { saved: true };
}

export type TestState = FormState & { sentTo?: string };

export async function sendTestCampaignAction(id: string, _: TestState, form: FormData): Promise<TestState> {
  const { shop } = await requireShop("marketing");
  const to = String(form.get("to") ?? "");
  try {
    await sendTestCampaign(await campaigns(), shop, id, to);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  return { sentTo: to.trim().toLowerCase() };
}

/** Sends now (the first batch goes out right away) or schedules it. */
export async function startCampaignAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop } = await requireShop("marketing");
  const when = String(form.get("when") ?? "now");
  const at = String(form.get("scheduledFor") ?? "");
  const ctx = await campaigns();
  try {
    const scheduledFor = when === "later" ? new Date(at) : null;
    if (scheduledFor && Number.isNaN(scheduledFor.getTime())) throw new UserError("Pick a date and time.");
    await startCampaign(ctx, shop, id, { scheduledFor });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  if (when !== "later") after(() => sendCampaignBatches(ctx).then(() => {}));
  revalidatePath("/admin/campaigns");
  redirect(`/admin/campaigns/${id}`);
}

export async function cancelScheduledCampaignAction(id: string) {
  const { shop, db } = await requireShop("marketing");
  await cancelScheduledCampaign(db, shop.id, id);
  revalidatePath(`/admin/campaigns/${id}`);
}

export async function deleteCampaignAction(id: string) {
  const { shop, db } = await requireShop("marketing");
  await deleteCampaign(db, shop.id, id);
  redirect("/admin/campaigns");
}

export async function duplicateCampaignAction(id: string) {
  const { shop, db, user } = await requireShop("marketing");
  const copy = await duplicateCampaign(db, shop.id, user.id, id);
  redirect(`/admin/campaigns/${copy.id}`);
}

export async function saveMailingAddressAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("marketing");
  try {
    await setMailingAddress(db, shop.id, String(form.get("mailingAddress") ?? ""));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/campaigns");
  return { saved: true };
}
