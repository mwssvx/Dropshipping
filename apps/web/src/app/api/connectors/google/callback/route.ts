import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connectGoogle } from "@sf/core";
import { adminUrl, connectors, GOOGLE_STATE_COOKIE, requireShop } from "@/lib/server";

/** Google sends the owner back here with a code; it becomes the store's connection. */
export async function GET(req: Request) {
  const { shop, user } = await requireShop("ai");
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get(GOOGLE_STATE_COOKIE)?.value;
  jar.delete(GOOGLE_STATE_COOKIE);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) redirect("/admin/connectors?google=declined");
  if (!state || !expected || state !== expected || !state.startsWith(`${shop.id}.`) || !code) redirect("/admin/connectors?google=mismatch");
  try {
    await connectGoogle(await connectors(), shop.id, { code, redirectUri: await adminUrl("/api/connectors/google/callback"), userId: user.id });
  } catch {
    redirect("/admin/connectors?google=failed");
  }
  redirect("/admin/connectors?google=connected");
}
