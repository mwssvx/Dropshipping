"use server";
import { revalidatePath } from "next/cache";
import { applyBulkEdit, previewBulkEdit, sendPriceDrops, undoBulkEdit, UserError, type BulkEditInput } from "@sf/core";
import { logged, requireShop, stock } from "@/lib/server";

export type BulkState = {
  key?: string;
  error?: string;
  done?: string;
  preview?: Awaited<ReturnType<typeof previewBulkEdit>>;
};

function actionFrom(form: FormData): BulkEditInput {
  const kind = String(form.get("kind") ?? "");
  const percent = Math.round(Number(String(form.get("percent") ?? "").replace(/[%\s]/g, "")));
  if ((kind === "price" || kind === "compare_at") && !Number.isFinite(percent)) throw new UserError("Enter a percent, like 10.");
  const collectionId = String(form.get("collectionId") ?? "");
  switch (kind) {
    case "active":
    case "draft":
    case "archived":
      return { kind: "status", status: kind };
    case "price":
      return { kind: "price", percent, ending: (["99", "95", "00", "none"] as const).find((e) => e === form.get("ending")) ?? "none" };
    case "compare_at":
      return { kind: "compare_at", percent };
    case "clear_compare_at":
      return { kind: "compare_at", percent: null };
    case "add":
    case "remove":
      if (!collectionId) throw new UserError("Pick a collection.");
      return { kind: "collection", collectionId, remove: kind === "remove" };
    case "add_tag":
    case "remove_tag": {
      const tag = String(form.get("tag") ?? "").trim();
      if (!tag) throw new UserError("Enter the tag, like summer.");
      return { kind: "tag", tag, remove: kind === "remove_tag" };
    }
    default:
      throw new UserError("Pick what to change.");
  }
}

export async function bulkEditAction(_: BulkState, form: FormData): Promise<BulkState> {
  const { shop, db, user } = await requireShop("products");
  const key = String(form.get("key") ?? "");
  const ids = form.getAll("ids").map(String);
  let input: BulkEditInput;
  let preview: BulkState["preview"];
  try {
    input = actionFrom(form);
    preview = await previewBulkEdit(db, shop, ids, input);
    if (form.get("intent") !== "apply") return { key, preview };
  } catch (e) {
    if (e instanceof UserError) return { key, error: e.message };
    throw e;
  }
  try {
    const edit = await applyBulkEdit(db, shop, ids, input, { allowBelowCost: form.get("belowCost") === "on", userId: user.id });
    await logged({ shop, user, db }, `Bulk edit: ${edit.summary}`, { href: "/admin/products" });
    // Buyers who saved a product hear about it when it gets cheaper.
    if (input.kind === "price") await sendPriceDrops(await stock(), { shopId: shop.id });
    revalidatePath("/admin/products");
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { done: edit.summary };
  } catch (e) {
    // Keep the preview up, so the merchant can tick "Sell below cost" and try again.
    if (e instanceof UserError) return { key, error: e.message, preview };
    throw e;
  }
}

export async function undoBulkEditAction(editId: string, _: BulkState): Promise<BulkState> {
  const { shop, db, user } = await requireShop("products");
  try {
    const { kept } = await undoBulkEdit(db, shop.id, editId);
    const edit = await db.query.bulkEdits.findFirst({ where: (b, { and, eq }) => and(eq(b.id, editId), eq(b.shopId, shop.id)), columns: { summary: true } });
    await logged({ shop, user, db }, `Undid the bulk edit: ${edit?.summary ?? "a change to products"}`, { href: "/admin/products" });
    revalidatePath("/admin/products");
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { done: kept ? `Undone. ${kept === 1 ? "1 change was" : `${kept} changes were`} edited since, so we left ${kept === 1 ? "it" : "them"} alone` : "Undone" };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
