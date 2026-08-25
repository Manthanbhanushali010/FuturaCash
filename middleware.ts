import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, isUnlocked } from "@/lib/page-gate";

/**
 * One choke point in front of the Xero screen and every Xero route.
 *
 * Deliberately middleware rather than a conditional render: hiding the Connect button would
 * still leave `/xero` rendering invoices and `/api/xero/connect` reachable by typing the URL.
 * A matcher also cannot be forgotten when a new route is added under `/api/xero/`.
 *
 * The OAuth callback is gated too. It arrives as a browser redirect from Xero, so the cookie
 * travels with it; the only cost is redoing the connect if the cookie expired mid-consent.
 */
export async function middleware(request: NextRequest) {
  const cookie = request.cookies.get(GATE_COOKIE)?.value;
  if (await isUnlocked(cookie)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = "";
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // `:path*` matches zero segments too, so this covers `/xero` itself as well as `/xero/…`.
  // `/unlock` and `/api/unlock` are deliberately absent — gating them would be a redirect loop.
  matcher: ["/xero/:path*", "/api/xero/:path*"],
};
