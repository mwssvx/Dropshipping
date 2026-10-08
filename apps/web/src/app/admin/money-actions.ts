"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addTaxRegistration,
  changePlan,
  parseMoney,
  refreshPayoutAccount,
  refundOrder,
  removeTaxRegistration,
  runFakePayouts,
  setPricesIncludeTax,
  setShopCurrencies,
  simulateHold,
  startPayoutSetup,
  submitRequirementDocument,
  UserError,
  type RequirementKind,
} from "@sf/core";
import { adminUrl, notifyLater, payments, refunds, requireShop, tax, testPayments } from "@/lib/server";
import type { FormState } from "./actions";

export type RefundState = FormState & { message?: string; warning?: string };

export async function setupPayoutsAction() {
  const { shop, user, db } = await requireShop("payouts");
  const url = await startPayoutSetup(db, payments(), shop, {
    email: user.email,
    returnUrl: await adminUrl("/admin/money/return"),
    refreshUrl: await adminUrl("/admin/money/setup"),
  });
  // Test mode connects at once and hands back our own return address. Going there from a server
  // action would leave the browser on the return route, where the page's forms can't post, so
  // finish here instead.
  if (url === (await adminUrl("/admin/money/return"))) {
    const fresh = await db.query.shops.findFirst({ where: (t, { eq }) => eq(t.id, shop.id) });
    await refreshPayoutAccount(db, payments(), fresh!);
    redirect("/admin/money?setup=done");
  }
  redirect(url);
}

export async function uploadDocumentAction(requirementId: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("money");
  const file = form.get("file");
  try {
    if (!(file instanceof File) || !file.size) throw new UserError("Choose a file to send.");
    await submitRequirementDocument(db, payments(), shop, requirementId, {
      name: file.name,
      type: file.type,
      data: Buffer.from(await file.arrayBuffer()),
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export async function simulateHoldAction(form: FormData) {
  if (!testPayments()) throw new Error("Only in test mode.");
  const { shop, db } = await requireShop("money");
  await simulateHold(db, shop.id, (String(form.get("kind") || "identity_document")) as RequirementKind);
  revalidatePath("/admin", "layout");
}

export async function runPayoutsAction() {
  if (!testPayments()) throw new Error("Only in test mode.");
  const { db } = await requireShop("money");
  // Pretend two days passed so today's sales have cleared.
  await runFakePayouts(db, new Date(Date.now() + 2 * 86_400_000 + 60_000));
  revalidatePath("/admin/money");
}

export async function changePlanAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, user, db } = await requireShop("plan");
  let url: string | null;
  try {
    ({ url } = await changePlan(db, payments(), shop, {
      plan: String(form.get("plan") ?? ""),
      email: user.email,
      returnUrl: await adminUrl("/admin/plan"),
    }));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  if (url) redirect(url);
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export async function refundAction(orderId: string, _: RefundState, form: FormData): Promise<RefundState> {
  const { shop } = await requireShop("refunds");
  try {
    const raw = String(form.get("amount") ?? "").trim();
    let amountMinor: number | undefined;
    if (raw) {
      try {
        amountMinor = parseMoney(raw);
      } catch {
        throw new UserError("Enter an amount like 12.50.");
      }
    }
    const result = await refundOrder(await refunds(), shop.id, orderId, { amountMinor, reason: String(form.get("reason") ?? "") });
    notifyLater(shop.id);
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");
    const warning = result.notCancelled.length
      ? `Couldn't stop the supplier order: ${result.notCancelled.map((n) => n.message).join(" ")}`
      : undefined;
    const message = result.full
      ? `Refunded in full. ${result.cancelled ? "The supplier order was cancelled. " : ""}We emailed the customer.`
      : "Refunded. We emailed the customer.";
    return { saved: true, message, warning };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function addTaxRegistrationAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("taxes");
  try {
    await addTaxRegistration(db, tax(), shop, {
      jurisdiction: String(form.get("jurisdiction") ?? ""),
      registrationNumber: String(form.get("registrationNumber") ?? ""),
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/taxes");
  return { saved: true };
}

export async function removeTaxRegistrationAction(id: string) {
  const { shop, db } = await requireShop("taxes");
  await removeTaxRegistration(db, shop.id, id);
  revalidatePath("/admin/taxes");
}

export async function setPricesIncludeTaxAction(form: FormData) {
  const { shop, db } = await requireShop("taxes");
  await setPricesIncludeTax(db, shop.id, form.get("pricesIncludeTax") === "1");
  revalidatePath("/admin/taxes");
}

export async function saveCurrenciesAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("currencies");
  try {
    await setShopCurrencies(db, shop, { currencies: form.getAll("currencies").map(String), round: form.get("round") === "on" });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/currencies");
  return { saved: true };
}
