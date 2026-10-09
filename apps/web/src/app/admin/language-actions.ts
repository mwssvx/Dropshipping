"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LANGUAGES, saveTranslation, setShopLanguages, translateStoreWithAi, UserError, type Language } from "@sf/core";
import { agents, requireShop } from "@/lib/server";
import type { FormState } from "./actions";

function refresh(handle: string) {
  revalidatePath(`/s/${handle}`, "layout");
  revalidatePath("/admin/languages", "layout");
}

export async function saveLanguagesAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("theme");
  try {
    await setShopLanguages(db, shop.id, form.getAll("languages").map(String));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  refresh(shop.handle);
  return { saved: true };
}

export type TranslateState = { error?: string; message?: string };

/** One press translates a batch; the page says how many are left so the merchant can press again. */
export async function translateAction(language: string, _: TranslateState): Promise<TranslateState> {
  const { shop } = await requireShop("theme");
  try {
    const r = await translateStoreWithAi(await agents(), shop, language, { batch: 10 });
    refresh(shop.handle);
    revalidatePath("/admin", "layout");
    if (r.status === "over_budget") return { error: "This month's AI budget is used up. You can raise it in AI settings, or translate by hand." };
    if (r.saved === 0 && r.left > 0) return { error: r.error ?? "The translator couldn't finish. Try again." };
    const name = LANGUAGES[language as Language]?.english ?? language;
    if (r.saved === 0) return { message: `Everything is already in ${name}.` };
    return { message: r.left ? `Translated ${r.saved} into ${name}. ${r.left} to go: press again to continue.` : `Translated ${r.saved} into ${name}. Everything is done; read it over below.` };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

/** The editor sends each original as k<n> and its translation as v<n>, so any text can be a key. */
export async function saveTranslationAction(language: string, kind: string, refId: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("theme");
  const fields: Record<string, string> = {};
  for (let n = 0; form.has(`k${n}`); n++) fields[String(form.get(`k${n}`))] = String(form.get(`v${n}`) ?? "");
  try {
    await saveTranslation(db, shop, { language, kind, refId, fields });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  refresh(shop.handle);
  redirect(`/admin/languages/${language}?saved=${kind}-${refId}`);
}
