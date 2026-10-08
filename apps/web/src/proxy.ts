import { NextResponse, type NextRequest } from "next/server";
import { STORE_HOST_HEADER } from "@/lib/brand";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").toLowerCase();
const SUBDOMAINS = process.env.NEXT_PUBLIC_STORE_SUBDOMAINS !== "off";

/** Our own addresses: the root domain, previews and local development. */
function isPlatformHost(host: string) {
  const bare = host.replace(/:\d+$/, "");
  return (
    host === ROOT ||
    host === `www.${ROOT}` ||
    bare === "localhost" ||
    bare === "127.0.0.1" ||
    bare.endsWith(".vercel.app")
  );
}

function rewriteToStore(request: NextRequest, headers: Headers, key: string) {
  const url = request.nextUrl.clone();
  // Links that already carry /s/<key> keep working as they are.
  if (url.pathname === `/s/${key}` || url.pathname.startsWith(`/s/${key}/`)) return NextResponse.rewrite(url, { request: { headers } });
  url.pathname = `/s/${key}${url.pathname === "/" ? "" : url.pathname}`;
  headers.set(STORE_HOST_HEADER, "1");
  return NextResponse.rewrite(url, { request: { headers } });
}

/**
 * Finds the store a request is for:
 * - <handle>.<root domain> is that store (when store subdomains are on);
 * - any other host that isn't ours is treated as a custom domain, and the store page looks up
 *   which verified domain it is (unknown domains get a 404);
 * - everything else is the platform itself (admin, sign up, /s/<handle> links).
 */
export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  // Never let a client pretend a request was mapped.
  const headers = new Headers(request.headers);
  headers.delete(STORE_HOST_HEADER);

  if (SUBDOMAINS && host.endsWith(`.${ROOT}`)) {
    const handle = host.slice(0, -(ROOT.length + 1));
    if (/^[a-z0-9-]+$/.test(handle) && handle !== "www") return rewriteToStore(request, headers, handle);
    return NextResponse.next({ request: { headers } });
  }
  if (!host || isPlatformHost(host)) return NextResponse.next({ request: { headers } });
  return rewriteToStore(request, headers, host.replace(/:\d+$/, ""));
}

export const config = { matcher: ["/((?!_next|api|favicon.ico).*)"] };
