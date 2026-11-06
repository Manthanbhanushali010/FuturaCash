import {
  XeroNotConnectedError,
  getConnectionState,
  missingScopes,
} from "@/integrations/xero";
import {
  XeroApiError,
  fetchBatchMemberPayments,
  fetchBatchPaymentById,
} from "@/integrations/xero/client";
import { buildBatchDetail, foreignRowCount } from "@/integrations/xero/batch-detail";
import { parseXeroGuid } from "@/integrations/xero/guid";
import { toReadFailure } from "../../read-failure-view";
import { BatchDetailView, type BatchDetailView as View } from "./batch-detail-view";

/**
 * One batch's payments — the FETCHING half. All markup lives in `batch-detail-view.tsx`.
 *
 * A server page, not a route plus client fetch. There are no client components anywhere in
 * this app, and that is load-bearing rather than stylistic: server-component props are never
 * serialised into the page, so supplier names and amounts exist only in the rendered HTML of
 * THIS page and never in `/xero`'s payload. A client-side drill-down would have had to ship
 * the same data through a JSON route and into the browser's memory.
 *
 * Behind the same gate as everything else: `middleware.ts` matches `/xero/:path*`, and
 * `:path*` matches further segments, so this page is covered by the existing matcher rather
 * than by a new rule that could be forgotten.
 */

export const dynamic = "force-dynamic";

/**
 * Up to 1 batch read + 5 payment pages = 6 sequential Xero calls. The ceiling is the same 60s
 * the Xero screen uses; a 136-member batch needs 3 calls and returns well inside it.
 */
export const maxDuration = 60;

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <BatchDetailView view={await readBatchDetail(id)} />
    </main>
  );
}

async function readBatchDetail(rawId: string): Promise<View> {
  // Validated BEFORE anything else happens. A non-GUID never reaches a Xero call, a URL path
  // or a `where` clause — so a malformed id costs nothing and cannot alter a query.
  const batchId = parseXeroGuid(rawId);
  if (batchId === null) return { kind: "INVALID_ID" };

  let tenantId: string;
  try {
    const state = await getConnectionState();
    if (!state || !state.activeTenantId) throw new XeroNotConnectedError();
    if (missingScopes(state.scope).includes("accounting.payments.read")) {
      return { kind: "SCOPE_MISSING" };
    }
    tenantId = state.activeTenantId;
  } catch (caught) {
    if (caught instanceof XeroNotConnectedError) {
      return { kind: "UNREADABLE", detail: "No Xero organisation is connected." };
    }
    throw caught;
  }

  try {
    const batch = await fetchBatchPaymentById(tenantId, batchId);
    if (batch === null) return { kind: "NOT_FOUND", batchId };

    const { items, truncated } = await fetchBatchMemberPayments(tenantId, batchId);

    // Every row must carry the id that was asked for. `where` is honoured on this endpoint
    // today, but `Statuses=` has been silently ignored on three endpoint families, so the
    // filter quietly ceasing to apply is a known failure mode. If it happens, the read is of
    // the whole ledger and no total from it means anything — so refuse before computing one.
    const foreignRows = foreignRowCount(items, batchId);
    if (foreignRows > 0) {
      return { kind: "FILTER_IGNORED", batchId, returned: items.length, foreignRows };
    }

    return {
      kind: "READY",
      detail: buildBatchDetail(batch, items, { fallbackCurrency: null, truncated }),
    };
  } catch (caught) {
    if (caught instanceof XeroApiError) {
      return { kind: "READ_FAILED", failure: toReadFailure(caught) };
    }
    // A projection failure, not a transport one: an unsupported currency, or a batch with no
    // total. Re-authorising would not help, so this must not offer it.
    return { kind: "UNREADABLE", detail: (caught as Error).message };
  }
}
