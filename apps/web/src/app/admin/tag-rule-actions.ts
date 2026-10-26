"use server";
import { revalidatePath } from "next/cache";
import { createTagRule, deleteTagRule, NotFoundError, parseMoney, UserError, type TagRuleInput } from "@sf/core";
import { logged, requireShop } from "@/lib/server";

export type TagRuleState = { error?: string; added?: { tag: string; tagged: number } };

/** Adds a tag rule from the Customers page and tags the customers who already match. */
export async function createTagRuleAction(_: TagRuleState, form: FormData): Promise<TagRuleState> {
  const { shop, db, user } = await requireShop("customers");
  try {
    const kind = String(form.get("kind") ?? "spent");
    const tag = String(form.get("tag") ?? "");
    const whole = (name: string) => Number.parseInt(String(form.get(name) ?? "").trim() || "0", 10) || 0;
    const input: TagRuleInput =
      kind === "bought"
        ? { kind, tag, productId: String(form.get("productId") ?? "") }
        : kind === "orders"
          ? { kind, tag, threshold: whole("orders") }
          : kind === "lapsed"
            ? { kind, tag, threshold: whole("days") }
            : { kind: "spent", tag, threshold: parseMoney(String(form.get("amount") ?? "").trim() || "0") };
    const { rule, applied } = await createTagRule(db, shop.id, input);
    await logged({ shop, user, db }, `Added the tag rule for "${rule.tag}"`, { href: "/admin/customers#tag-rules" });
    revalidatePath("/admin/customers");
    return { added: { tag: rule.tag, tagged: applied?.tagged ?? 0 } };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function deleteTagRuleAction(id: string) {
  const { shop, db, user } = await requireShop("customers");
  try {
    const { rule } = await deleteTagRule(db, shop.id, id);
    await logged({ shop, user, db }, `Removed the tag rule for "${rule.tag}"`, { href: "/admin/customers#tag-rules" });
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
  revalidatePath("/admin/customers");
}
