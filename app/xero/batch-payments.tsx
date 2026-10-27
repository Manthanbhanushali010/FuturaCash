import { isCurrencyCode } from "@/core/money";
import {
  buildBatchPaymentCard,
  type BatchPaymentCard,
  type BatchCurrencySubtotal,
} from "@/integrations/xero/batch-card";
import {
  RECONCILIATION_WINDOW_DAYS,
  XeroApiError,
  fetchBatchPayments,
  recentWindow,
} from "@/integrations/xero/client";
import { Card, Cell, Empty, Figure, Notice, Pill, Row, Table, formatDay } from "./parts";

/**
 * Batch payments — a standalone card, not part of any cash position.
 *
 * The label is load-bearing. A batch payment has already left the bank, so it is already
 * inside the bank-transaction read; the two agreed to the penny when measured (26 batches at
 * 661,964.41 GBP against 619 member payments excluded as BATCH_MEMBER at 661,964.41 GBP).
 * Presenting these totals anywhere near a net figure would double-count real money, so this
 * card states plainly that it adds to nothing.
 */

/** Rendered rows. One call returns every batch in the window, so this is a display cap only. */
const MAX_ROWS = 100;

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

export async function BatchPaymentsCard({
  tenantId,
  baseCurrency,
  scopeMissing,
}: BatchPaymentsCardProps) {
  if (scopeMissing) {
    return (
      <Shell>
        <Notice tone="info" title="Batch payments need another permission">
          <p>
            This connection does not include <code>accounting.payments.read</code>, so{" "}
            <code>/BatchPayments</code> would return 401. Re-authorise to include it. No figure
            is shown here rather than a zero, because zero and &ldquo;not permitted to
            look&rdquo; are different facts.
          </p>
        </Notice>
      </Shell>
    );
  }

  const window = recentWindow();

  let card: BatchPaymentCard;
  try {
    const { items, truncated } = await fetchBatchPayments(tenantId, { window });
    // Belt and braces. `fetchBatchPayments` is one unpaginated call and hard-codes
    // `truncated: false` because Xero ignores `page` on this endpoint — but if that ever
    // stops being true, a partial read must not be rendered as though it were complete.
    if (truncated) {
      return (
        <Shell>
          <Notice tone="error" title="This read was cut short — no figures shown">
            <p>
              Xero returned only part of the batch payments for this window. Subtotals over an
              unknown subset are indistinguishable from complete ones, so none are shown.
            </p>
          </Notice>
        </Shell>
      );
    }
    card = buildBatchPaymentCard(items, {
      // Never coerced to a default. Unsupported or absent means "unknown", and a batch that
      // also lacks its own account currency is then reported, not labelled with a guess.
      fallbackCurrency:
        baseCurrency && isCurrencyCode(baseCurrency) ? baseCurrency : null,
    });
  } catch (caught) {
    const detail =
      caught instanceof XeroApiError ? caught.message : (caught as Error).message;
    return (
      <Shell>
        <Notice tone="error" title="Batch payments could not be read">
          <p>{detail}</p>
          <p className="mt-2">
            Nothing is shown rather than zeros — a failed read and an empty window look
            identical once they have both been rendered as 0.
          </p>
        </Notice>
      </Shell>
    );
  }

  const since = formatDay(window.since.toISOString());

  return (
    <Card
      title="Batch payments"
      subtitle={
        <>
          <strong className="text-primary">
            Already included in bank transactions. Not additional.
          </strong>{" "}
          AUTHORISED batches dated on or after {since} ({RECONCILIATION_WINDOW_DAYS} days).
          PAYBATCH = money out · RECBATCH = money in. Member counts come from the payments
          nested in each batch, not from a second read.
        </>
      }
    >
      {card.rows.length === 0 ? (
        <Empty>No AUTHORISED batch payments dated on or after {since}.</Empty>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            {card.subtotals.map((subtotal) => (
              <SubtotalPair key={subtotal.currency} subtotal={subtotal} />
            ))}
          </dl>
          <p className="px-5 py-3 text-xs text-muted">
            Subtotals are grouped by currency and by direction, and never summed across
            either. Money in and money out are different facts; one combined figure would net
            a supplier run against a customer receipt. Neither of these subtotals feeds the
            cash position.
          </p>

          <Table head={["Date", "Direction", "Status", "Payments", "Total"]}>
            {card.rows.slice(0, MAX_ROWS).map((row) => (
              <Row key={row.externalId}>
                <Cell muted>
                  <span className="figure">{formatDay(row.paidAt)}</span>
                </Cell>
                <Cell muted>{row.direction === "INFLOW" ? "In" : "Out"}</Cell>
                <Cell>
                  <Pill
                    label={row.providerStatus || "—"}
                    tone={row.tie === "TIES" ? "neutral" : "warn"}
                  />
                </Cell>
                <Cell align="right">
                  <span className="figure">{row.memberCount}</span>
                </Cell>
                <Cell align="right">
                  <Figure value={row.total} />
                </Cell>
              </Row>
            ))}
          </Table>
          {card.rows.length > MAX_ROWS ? (
            <p className="px-5 py-3 text-xs text-muted">
              Showing the first {MAX_ROWS} of {card.rows.length}.
            </p>
          ) : null}
        </>
      )}

      <div className="space-y-4 px-5 py-4">
        <IntegrityBucket card={card} />
        {card.futureDated > 0 ? (
          <Notice tone="info" title={`${card.futureDated} batch(es) are dated in the future`}>
            <p>
              The window has a lower bound only, so a scheduled batch dated after today is
              inside it. Counted here rather than hidden: it is real, but it is not money that
              has moved.
            </p>
          </Notice>
        ) : null}
        {card.failures.length > 0 ? (
          <Notice
            tone="error"
            title={`${card.failures.length} batch(es) could not be read`}
          >
            <ul className="list-disc space-y-1 pl-5">
              {card.failures.slice(0, 10).map((failure, index) => (
                <li key={`${failure.externalId ?? "unknown"}-${index}`}>
                  <span className="figure">{failure.externalId ?? "(no id)"}</span> —{" "}
                  {failure.reason}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              These are excluded from the subtotals above, and reported rather than dropped.
            </p>
          </Notice>
        ) : null}
      </div>
    </Card>
  );
}

/** The must-be-empty bucket. Shown even when empty — an unstated check is not a check. */
function IntegrityBucket({ card }: { card: BatchPaymentCard }) {
  const count = card.integrityBucket.length;
  if (count === 0) {
    return (
      <p className="text-xs text-muted">
        <span className="figure text-primary">0</span> batches disagree with the payments
        nested inside them. Every batch total equals the sum of its members&rsquo;{" "}
        <code>BankAmount</code> — which is also the check that would catch Xero silently
        capping how many members it returns.
      </p>
    );
  }
  return (
    <Notice
      tone="error"
      title={`${count} batch(es) do not equal the sum of their nested payments`}
    >
      <ul className="list-disc space-y-1 pl-5">
        {card.integrityBucket.slice(0, 10).map((row) => (
          <li key={row.externalId}>
            <span className="figure">{formatDay(row.paidAt)}</span> — {row.tieReason}
          </li>
        ))}
      </ul>
      <p className="mt-2">
        This bucket is expected to be empty. A non-zero count means the batch total and its
        members are telling different stories, so neither should be trusted until it is
        explained.
      </p>
    </Notice>
  );
}

function SubtotalPair({ subtotal }: { subtotal: BatchCurrencySubtotal }) {
  return (
    <>
      <Stat
        label={`${subtotal.currency} in · ${subtotal.inflowCount} batch(es)`}
        value={<Figure value={subtotal.inflow} />}
      />
      <Stat
        label={`${subtotal.currency} out · ${subtotal.outflowCount} batch(es)`}
        value={<Figure value={subtotal.outflow} />}
      />
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-primary">{value}</dd>
    </div>
  );
}

/** The card chrome, so every failure path still renders inside the same labelled card. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Card
      title="Batch payments"
      subtitle="Already included in bank transactions. Not additional."
    >
      <div className="px-5 py-4">{children}</div>
    </Card>
  );
}

/** What the page shows while the batch read is in flight. */
export function BatchPaymentsCardSkeleton() {
  return (
    <Card
      title="Batch payments"
      subtitle="Already included in bank transactions. Not additional."
    >
      <Empty>Reading batch payments…</Empty>
    </Card>
  );
}
