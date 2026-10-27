import { isCurrencyCode } from "@/core/money";
import { buildBatchPaymentCard } from "@/integrations/xero/batch-card";
import {
  RECONCILIATION_WINDOW_DAYS,
  XeroApiError,
  fetchBatchPayments,
  recentWindow,
} from "@/integrations/xero/client";
import { formatDay } from "./parts";
import { BatchPaymentsView, type BatchPaymentsView as View } from "./batch-payments-view";

/**
 * Batch payments — the fetching half. All of the rendering lives in
 * `batch-payments-view.tsx`, which is a pure function of the view model built here.
 *
 * The split exists so every state this card can reach is testable: this file does I/O and
 * cannot be rendered in a test, while the view can and is.
 */

interface BatchPaymentsCardProps {
  tenantId: string;
  /**
   * Org base currency, as Xero reports it. Used only when a batch's bank account omits its
   * own currency, and passed through unvalidated so an unsupported one (JENKI already has a
   * CNY transaction `core/money` rejects) degrades to a reported failure on the affected
   * batches rather than taking out the card.
   */
  baseCurrency: string | null;
  /** True when the grant lacks `accounting.payments.read`; the endpoint would 401. */
  scopeMissing: boolean;
}

export async function BatchPaymentsCard(props: BatchPaymentsCardProps) {
  return <BatchPaymentsView view={await readBatchPayments(props)} />;
}

async function readBatchPayments({
  tenantId,
  baseCurrency,
  scopeMissing,
}: BatchPaymentsCardProps): Promise<View> {
  if (scopeMissing) return { kind: "SCOPE_MISSING" };

  const window = recentWindow();

  try {
    const { items, truncated } = await fetchBatchPayments(tenantId, { window });
    // Belt and braces. `fetchBatchPayments` is one unpaginated call and hard-codes
    // `truncated: false` because Xero ignores `page` on this endpoint — but if that ever
    // stops being true, a partial read must not be rendered as though it were complete.
    if (truncated) return { kind: "TRUNCATED" };

    return {
      kind: "READY",
      card: buildBatchPaymentCard(items, {
        // Never coerced to a default. Unsupported or absent means "unknown", and a batch that
        // also lacks its own account currency is then reported, not labelled with a guess.
        fallbackCurrency: baseCurrency && isCurrencyCode(baseCurrency) ? baseCurrency : null,
      }),
      windowSince: formatDay(window.since.toISOString()),
      windowDays: RECONCILIATION_WINDOW_DAYS,
    };
  } catch (caught) {
    return {
      kind: "FAILED",
      detail: caught instanceof XeroApiError ? caught.message : (caught as Error).message,
    };
  }
}

export { BatchPaymentsCardSkeleton } from "./batch-payments-view";
