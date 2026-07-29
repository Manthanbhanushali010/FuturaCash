import { NextResponse, type NextRequest } from "next/server";
import {
  XeroApiError,
  exchangeCodeForTokens,
  fetchConnections,
  toTokenState,
} from "@/integrations/xero/client";
import { XeroNotConfiguredError } from "@/integrations/xero/config";
import { getXeroTokenStore } from "@/integrations/xero/tokens";
import { OAUTH_STATE_COOKIE, statesMatch } from "@/lib/oauth-state";

/**
 * Step 2: Xero redirects here with an authorisation code. We verify state, exchange the
 * code for tokens, resolve which organisations the consent covers, and persist.
 *
 * Nothing in this handler logs a code, a token, or a secret (invariant #7).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every failure ends on /xero with a readable reason — never a blank page or a stack trace. */
function failure(request: NextRequest, reason: string): NextResponse {
  const url = new URL("/xero", request.nextUrl.origin);
  url.searchParams.set("error", reason);
  const response = NextResponse.redirect(url, { status: 303 });
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;

  const oauthError = params.get("error");
  if (oauthError) {
    // Most often access_denied — the operator declined consent.
    return failure(request, `Xero returned "${oauthError}"`);
  }

  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!statesMatch(params.get("state") ?? undefined, expectedState)) {
    // Reject BEFORE exchanging the code — an unverified code is not ours to spend.
    return failure(request, "State mismatch — the sign-in did not start here. Try connecting again.");
  }

  const code = params.get("code");
  if (!code) {
    return failure(request, "Xero did not return an authorisation code");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const connections = await fetchConnections(tokens.access_token);
    if (connections.length === 0) {
      return failure(request, "Consent granted but no organisation was authorised");
    }

    const store = getXeroTokenStore();
    const state = toTokenState(tokens, connections, await store.read(), Date.now());
    await store.write(state);

    const url = new URL("/xero", request.nextUrl.origin);
    if (!state.activeTenantId) {
      // Several orgs authorised — the operator chooses; we never guess whose books to read.
      url.searchParams.set("select", "1");
    }
    const response = NextResponse.redirect(url, { status: 303 });
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    if (error instanceof XeroNotConfiguredError || error instanceof XeroApiError) {
      return failure(request, error.message);
    }
    throw error;
  }
}
