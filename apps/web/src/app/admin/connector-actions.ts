"use server";
import { revalidatePath } from "next/cache";
import { disconnectGoogle } from "@sf/core";
import { requireShop } from "@/lib/server";

export async function disconnectGoogleAction() {
  const { shop, db } = await requireShop("ai");
  await disconnectGoogle(db, shop.id);
  revalidatePath("/admin/connectors");
}
