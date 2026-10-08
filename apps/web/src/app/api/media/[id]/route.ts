import { getMedia } from "@sf/core";
import { db } from "@/lib/server";

/** Product photos uploaded from the app. Ids are random, and a photo never changes once stored. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const media = await getMedia(await db(), (await params).id);
  if (!media) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(media.data), {
    headers: {
      "content-type": media.contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
