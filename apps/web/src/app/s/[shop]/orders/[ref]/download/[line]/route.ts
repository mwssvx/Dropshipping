import { NotFoundError, takeDownload, UserError } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../../../../data";

export const dynamic = "force-dynamic";

/** A paid order's download link, from its email or order page. Each one counts toward the order's limit. */
export async function GET(_request: Request, { params }: { params: Promise<{ shop: string; ref: string; line: string }> }) {
  const { shop: handle, ref, line } = await params;
  const shop = await loadShop(handle);
  try {
    const file = await takeDownload(await db(), shop.id, ref, line);
    return new Response(new Uint8Array(file.data), {
      headers: {
        // Always saved, never shown in the browser: the file is whatever the merchant uploaded.
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${file.name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Content-Length": String(file.bytes),
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (e instanceof UserError) {
      const why = /refunded/.test(e.message) ? "refunded" : /paid/.test(e.message) ? "unpaid" : "limit";
      // A relative address, so it stays on whichever of the store's addresses the buyer used.
      return new Response(null, { status: 303, headers: { Location: `${await storeBase(handle)}/orders/${encodeURIComponent(ref)}?download=${why}#downloads` } });
    }
    throw e;
  }
}
