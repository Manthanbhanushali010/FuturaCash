import Link from "next/link";
import type { ReactNode } from "react";
import type { BatchDetail } from "@/integrations/xero/batch-detail";
import { Card, Cell, Empty, Figure, Notice, Pill, Row, Table, formatDay } from "../../parts";
import { ReadFailureNotice, type ReadFailure } from "../../read-failure-view";

/**
 * One batch's payments — MARKUP only, no I/O.
 *
 * Same split as the batch payments card, for the same reason: every state this page can reach
 * is a rendering decision, and an async server component cannot be handed to
 * `renderToStaticMarkup`. As a pure function of a view model it can be, so "a missing value
 * is an em dash and never a zero" is asserted in the HTML rather than promised in a comment.
 */

export const PAGE_TITLE = "Batch payments";

/** Rendered as the value of any column Xero left empty. Never a zero, never a blank cell. */
export const EM_DASH = "—";

export type BatchDetailView =
  | { kind: "INVALID_ID" }
  | { kind: "SCOPE_MISSING" }
  | { kind: "NOT_FOUND"; batchId: string }
  | { kind: "FILTER_IGNORED"; batchId: string; returned: number; foreignRows: number }
  | { kind: "READ_FAILED"; failure: ReadFailure }
  /**
   * The read succeeded but the batch could not be projected — e.g. an unsupported currency,
   * or neither TotalAmount nor Amount. Distinct from READ_FAILED because re-authorising
   * would not help, so no Re-authorise is offered.
   */
  | { kind: "UNREADABLE"; detail: string }
  | { kind: "READY"; detail: BatchDetail };

export function BatchDetailView({ view }: { view: BatchDetailView }) {
  if (view.kind === "INVALID_ID") {
    return (
      <Shell>
        <Notice tone="error" title="That is not a batch id">
          <p>
            A batch id is a GUID. This one is not, so no Xero call was made — the id is checked
            before it reaches the query, not after.
          </p>
        </Notice>
      </Shell>
    );
  }

  if (view.kind === "SCOPE_MISSING") {
    return (
      <Shell>
        <Notice tone="info" title="This needs another permission">
          <p>
            This connection does not include <code>accounting.payments.read</code>, so{" "}
            <code>/Payments</code> would return 401. Nothing is shown rather than a zero.
          </p>
        </Notice>
      </Shell>
    );
  }

  if (view.kind === "NOT_FOUND") {
    return (
      <Shell>
        <Notice tone="error" title="No such batch">
          <p>
            Xero returned no batch with this id. Nothing is shown — an empty batch and a batch
            that does not exist are different facts.
          </p>
        </Notice>
      </Shell>
    );
  }

  /**
   * The filter stopped applying.
   *
   * `Statuses=` has been silently ignored on three endpoint families, so a `where` filter
   * quietly ceasing to apply is a known failure mode rather than a hypothetical. If it
   * happens here the read is of the whole payments ledger, and every figure derived from it
   * would be wrong while looking entirely plausible. So no figure is rendered at all.
   */
  if (view.kind === "FILTER_IGNORED") {
    return (
      <Shell>
        <Notice tone="error" title="The batch filter was not applied — no figures shown">
          <p>
            Xero returned <span className="figure">{view.returned}</span> payment(s), of which{" "}
            <span className="figure">{view.foreignRows}</span> belong to a different batch. The{" "}
            <code>BatchPaymentID</code> filter is therefore not being honoured, so no total can
            be trusted and none is shown.
          </p>
        </Notice>
      </Shell>
    );
  }

  if (view.kind === "UNREADABLE") {
    return (
      <Shell>
        <Notice tone="error" title="This batch could not be read">
          <p>{view.detail}</p>
          <p className="mt-2">
            The call to Xero succeeded; the batch itself could not be turned into figures.
            Nothing is shown rather than a partial total, and re-authorising would not change
            this.
          </p>
        </Notice>
      </Shell>
    );
  }

  if (view.kind === "READ_FAILED") {
    return (
      <Shell>
        <ReadFailureNotice failure={view.failure} />
      </Shell>
    );
  }

  const { detail } = view;

  return (
    <Card
      title={PAGE_TITLE}
      subtitle={
        <>
          <span className="figure">{formatDay(detail.batchDate)}</span> · {detail.providerType} ·{" "}
          {detail.providerStatus} · <span className="figure">{detail.memberCount}</span>{" "}
          payment(s). Amounts are each payment&rsquo;s <code>BankAmount</code>, the figure in
          the bank account&rsquo;s currency, which is the only basis that can be summed against
          the batch total.
        </>
      }
    >
      <div className="px-5 pt-4">
        <BackLink />
      </div>

      {detail.truncated ? (
        <div className="px-5 pt-4">
          <Notice tone="error" title="This is only part of the batch">
            <p>
              The page cap was reached, so the rows below are a subset and the footer is not the
              batch total. A total over an unknown subset is indistinguishable from a complete
              one.
            </p>
          </Notice>
        </div>
      ) : null}

      {detail.tie !== "TIES" ? (
        <div className="px-5 pt-4">
          <Notice
            tone="error"
            title={
              detail.tie === "MISMATCH"
                ? "The rows do not sum to the batch total"
                : "The rows could not be checked against the batch total"
            }
          >
            <p>{detail.tieReason}</p>
            <p className="mt-2">
              Batch total <Figure value={detail.batchTotal} /> · rows{" "}
              {detail.tie === "MISMATCH" ? <Figure value={detail.membersTotal} /> : EM_DASH}.
              Both figures are shown as they are; neither is adjusted to agree.
            </p>
          </Notice>
        </div>
      ) : null}

      {detail.members.length === 0 ? (
        <Empty>Xero returned no payments for this batch.</Empty>
      ) : (
        <>
          <Table head={["Payee", "Invoice", "Date", "Amount"]}>
            {detail.members.map((member) => (
              <Row key={member.paymentId}>
                <Cell>{member.payee ?? EM_DASH}</Cell>
                <Cell muted>
                  {member.invoiceNumber === null ? (
                    EM_DASH
                  ) : (
                    <span className="figure">{member.invoiceNumber}</span>
                  )}
                </Cell>
                <Cell muted>
                  <span className="figure">
                    {member.paidAt === null ? EM_DASH : formatDay(member.paidAt)}
                  </span>
                </Cell>
                <Cell align="right">
                  {member.amount === null ? EM_DASH : <Figure value={member.amount} />}
                </Cell>
              </Row>
            ))}
          </Table>

          <Footer detail={detail} />
        </>
      )}
    </Card>
  );
}

/**
 * The footer total.
 *
 * Shows the summed rows AND the batch's own total, always both. Showing one number would hide
 * whichever of the two is wrong; showing both makes a disagreement visible without needing to
 * be trusted. When they tie it says so explicitly, because an unstated check is not a check.
 */
function Footer({ detail }: { detail: BatchDetail }) {
  const ties = detail.tie === "TIES";
  return (
    <div className="space-y-2 border-t border-border px-5 py-4">
      <dl className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs uppercase tracking-wider text-muted">
            {detail.memberCount} payment(s), summed
          </dt>
          <dd className="mt-1 text-sm text-primary">
            {detail.tie === "UNCHECKABLE" ? EM_DASH : <Figure value={detail.membersTotal} />}
          </dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs uppercase tracking-wider text-muted">
            Batch total, as Xero reports it
          </dt>
          <dd className="mt-1 text-sm text-primary">
            <Figure value={detail.batchTotal} />
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted">
        {ties ? (
          <>
            These agree to the penny. <Pill label="ties" /> The rows are the whole batch.
          </>
        ) : (
          <>
            These do not agree, and neither figure has been adjusted. <Pill label="check" tone="warn" />
          </>
        )}
      </p>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/xero" className="text-xs text-muted underline hover:text-primary">
      ← Back to the Xero screen
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <Card title={PAGE_TITLE}>
      <div className="space-y-4 px-5 py-4">
        <BackLink />
        {children}
      </div>
    </Card>
  );
}
