import { NextResponse, type NextRequest } from "next/server";
import { clearChartOfAccountsCache } from "@/integrations/xero/client";
import { getXeroTokenStore } from "@/integrations/xero/tokens";

/**
 * Drop the local connection: forget the tokens and the cached chart of accounts.
 *
 * POST, not GET — disconnecting is a state change and must not be triggerable by a link
 * or a prefetch. This revokes nothing at Xero's end; the org owner does that in Xero.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  await getXeroTokenStore().clear();
  clearChartOfAccountsCache();
  return NextResponse.redirect(new URL("/xero", request.nextUrl.origin), { status: 303 });
}
