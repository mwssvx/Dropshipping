import { NextResponse, type NextRequest } from "next/server";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").toLowerCase();

/**
 * Storefronts live at <handle>.<root domain>. A request on a store subdomain is rewritten to
 * /s/<handle>/..., which is also reachable directly in development. Custom domains come in M3.
 */
export function proxy(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_STORE_SUBDOMAINS === "off") return NextResponse.next();
  const host = (request.headers.get("host") ?? "").toLowerCase();
  if (host === ROOT || !host.endsWith(`.${ROOT}`)) return NextResponse.next();
  const handle = host.slice(0, -(ROOT.length + 1));
  if (!/^[a-z0-9-]+$/.test(handle) || handle === "www") return NextResponse.next();
  const url = request.nextUrl.clone();
  if (url.pathname === `/s/${handle}` || url.pathname.startsWith(`/s/${handle}/`)) return NextResponse.rewrite(url);
  url.pathname = `/s/${handle}${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/((?!_next|api|favicon.ico).*)"] };
