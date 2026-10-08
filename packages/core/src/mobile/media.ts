import { eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "../errors";

export const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

/** Checks the first bytes too, so a renamed file can't pass as a photo. */
function sniff(data: Buffer): string | null {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function saveMedia(db: Db, shopId: string, data: Buffer) {
  if (data.length === 0) throw new UserError("The photo is empty.");
  if (data.length > MAX_MEDIA_BYTES) throw new UserError("Photos can be up to 5 MB.");
  const contentType = sniff(data);
  if (!contentType) throw new UserError("Use a JPG, PNG or WebP photo.");
  const [row] = await db.insert(schema.media).values({ shopId, contentType, bytes: data.length, data }).returning({ id: schema.media.id });
  return { id: row!.id, contentType };
}

export async function getMedia(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await db.query.media.findFirst({ where: eq(schema.media.id, id) })) ?? null;
}
