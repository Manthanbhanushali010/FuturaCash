import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { clearChartOfAccountsCache } from "@/integrations/xero/client";
import { getXeroTokenStore } from "@/integrations/xero/tokens";

/**
 * Bind reads to one authorised organisation.
 *
 * Exists because consent can cover several orgs. Defaulting to the first one would mean
 * showing a company's books without anyone having chosen them — so the choice is explicit,
 * and only a tenant present in the stored connections can be selected.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ tenantId: z.string().min(1) });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();
  const parsed = Body.safeParse({ tenantId: form.get("tenantId") });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "tenantId is required" }, { status: 400 });
  }

  const store = getXeroTokenStore();
  const state = await store.read();
  if (!state) {
    return NextResponse.json({ ok: false, error: "No Xero connection" }, { status: 409 });
  }

  const authorised = state.connections.some((c) => c.tenantId === parsed.data.tenantId);
  if (!authorised) {
    // Never trust a tenant id from the request body — it must be one consent actually covered.
    return NextResponse.json({ ok: false, error: "Unknown organisation" }, { status: 403 });
  }

  await store.write({ ...state, activeTenantId: parsed.data.tenantId });
  clearChartOfAccountsCache();
  return NextResponse.redirect(new URL("/xero", request.nextUrl.origin), { status: 303 });
}
