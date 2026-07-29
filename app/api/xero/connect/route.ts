import { NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/integrations/xero/client";
import { XeroNotConfiguredError } from "@/integrations/xero/config";
import { OAUTH_STATE_COOKIE, createOAuthState, stateCookieOptions } from "@/lib/oauth-state";

/** Step 1 of the OAuth2 dance: send the operator to Xero's consent screen. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  let authorizeUrl: string;
  const state = createOAuthState();

  try {
    authorizeUrl = buildAuthorizeUrl(state);
  } catch (error) {
    if (error instanceof XeroNotConfiguredError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }
    throw error;
  }

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state, stateCookieOptions());
  return response;
}
