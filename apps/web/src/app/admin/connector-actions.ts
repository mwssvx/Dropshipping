"use server";
import { revalidatePath } from "next/cache";
import { disconnectGoogle } from "@sf/core";
import { connectors, requireShop } from "@/lib/server";

export async function disconnectGoogleAction() {
  const { shop } = await requireShop("ai");
  await disconnectGoogle(await connectors(), shop.id);
  revalidatePath("/admin/connectors");
}
