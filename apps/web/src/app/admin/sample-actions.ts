"use server";
import { revalidatePath } from "next/cache";
import { orderSample, UserError } from "@sf/core";
import { logged, requireShop, suppliers } from "@/lib/server";

export type SampleState = { error?: string; message?: string };

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/** Orders one of a supplier product's options to the merchant's own address. */
export async function orderSampleAction(productId: string, _: SampleState, form: FormData): Promise<SampleState> {
  const { shop, user, db } = await requireShop("products");
  try {
    const sample = await orderSample(db, suppliers(), shop, {
      variantId: field(form, "variantId"),
      email: user.email,
      address: {
        name: field(form, "name"),
        line1: field(form, "line1"),
        ...(field(form, "line2") ? { line2: field(form, "line2") } : {}),
        city: field(form, "city"),
        ...(field(form, "region") ? { region: field(form, "region") } : {}),
        postalCode: field(form, "postalCode"),
        country: field(form, "country").toUpperCase(),
      },
    });
    await logged({ shop, user, db }, `Ordered a sample of ${sample.title}`, { href: `/admin/products/${productId}` });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/admin/products/${productId}`);
  return { message: "Sample ordered. The supplier charges its cost and shipping the way it does for orders, and tracking shows here once it ships." };
}
