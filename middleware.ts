import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, isUnlocked } from "./lib/page-gate";

/**
 * One choke point in front of the Xero screen and every Xero route.
 *
 * Deliberately middleware rather than a conditional render: hiding the Connect button would
 * still leave `/xero` rendering invoices and `/api/xero/connect` reachable by typing the URL.
 * A matcher also cannot be forgotten when a new route is added under `/api/xero/`.
 */

/**
 * Browsers announce a top-level navigation; `fetch`, curl and scripts do not.
 *
 * This matters because two of the Xero routes are navigations, not API calls:
 * `/api/xero/connect` is where the landing page's "Get started" and "Log in" links point,
 * and `/api/xero/callback` is where Xero sends the browser back. A bare 401 on those would
 * dead-end a human mid-flow, while a redirect on a programmatic call is worse than useless —
 * a script following redirects would read an HTML password form as a 200.
 *
 * So: humans get the prompt, machines get 401. Neither gets data.
 */
function isBrowserNavigation(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-mode") === "navigate") return true;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

export async function middleware(request: NextRequest) {
  const cookie = request.cookies.get(GATE_COOKIE)?.value;
  if (await isUnlocked(cookie)) {
    return NextResponse.next();
  }

  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  if (isApiRoute && !isBrowserNavigation(request)) {
    return NextResponse.json(
      {
        error: "unauthorized",
        message: "This endpoint is behind the access gate. Authenticate at /unlock.",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
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
