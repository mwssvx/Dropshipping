import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminUrl, GOOGLE_STATE_COOKIE, googleProvider, requireShop } from "@/lib/server";

/** Sends the owner to Google to say yes. The state cookie ties the answer to this browser and store. */
export async function GET() {
  const { shop } = await requireShop("ai");
  const state = `${shop.id}.${randomBytes(16).toString("base64url")}`;
  (await cookies()).set(GOOGLE_STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  redirect(googleProvider().authUrl({ state, redirectUri: await adminUrl("/api/connectors/google/callback") }));
}
