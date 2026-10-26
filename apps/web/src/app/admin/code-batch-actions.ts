"use server";
import { revalidatePath } from "next/cache";
import { createCodeBatch, parseMoney, setCodeBatchActive, UserError } from "@sf/core";
import { logged, requireShop } from "@/lib/server";

export type CodeBatchState = { error?: string; made?: { id: string; count: number; name: string } };

/** Makes a batch of one-time codes from the Marketing page. */
export async function createCodeBatchAction(_: CodeBatchState, form: FormData): Promise<CodeBatchState> {
  const { shop, db, user } = await requireShop("marketing");
  try {
    const kind = String(form.get("kind") ?? "percent") as "percent" | "amount" | "free_shipping";
    const raw = String(form.get("value") ?? "").trim();
    const min = String(form.get("minSubtotal") ?? "").trim();
    const ends = String(form.get("endsAt") ?? "").trim();
    const endsAt = ends ? new Date(`${ends}T23:59:59Z`) : null;
    if (endsAt && Number.isNaN(endsAt.getTime())) throw new UserError("Enter dates as YYYY-MM-DD.");
    const batch = await createCodeBatch(db, shop.id, {
      name: String(form.get("name") ?? ""),
      prefix: String(form.get("prefix") ?? ""),
      count: Number.parseInt(String(form.get("count") ?? "0"), 10) || 0,
      kind,
      value: kind === "percent" ? Number.parseInt(raw || "0", 10) : kind === "amount" ? parseMoney(raw || "0") : 0,
      minSubtotalMinor: min ? parseMoney(min) : 0,
      endsAt,
    });
    await logged({ shop, user, db }, `Made ${batch.count} one-time codes (${batch.name})`, { href: "/admin/marketing#one-time-codes" });
    revalidatePath("/admin/marketing");
    return { made: { id: batch.id, count: batch.count, name: batch.name } };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function setCodeBatchActiveAction(id: string, active: boolean) {
  const { shop, db, user } = await requireShop("marketing");
  const batch = await setCodeBatchActive(db, shop.id, id, active);
  await logged({ shop, user, db }, `${active ? "Turned on" : "Turned off"} the one-time codes ${batch.name}`, { href: "/admin/marketing#one-time-codes" });
  revalidatePath("/admin/marketing");
}
