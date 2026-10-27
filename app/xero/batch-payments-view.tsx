import type { ReactNode } from "react";
import {
  MEMBER_COUNT_TO_FLAG,
  type BatchCurrencySubtotal,
  type BatchPaymentCard,
  type BatchPaymentRow,
} from "@/integrations/xero/batch-card";
import { Card, Cell, Empty, Figure, Notice, Pill, Row, Table, formatDay } from "./parts";

/**
 * The Batch payments card's MARKUP, with no I/O of its own.
 *
 * Split from the fetching deliberately. Every state this card can be in — a failed read, a
 * truncated read, a missing scope, a mismatch, a scheduled batch — is a rendering decision,
 * and those were previously unverifiable: an async server component cannot be passed to
 * `renderToStaticMarkup`. As a pure function of a view model it can, so the rule that matters
 * most here ("never show zeros instead of an error") is asserted in the rendered HTML rather
 * than argued for in a comment.
 */

export const CARD_TITLE = "Batch payments";

/** The label is only true of batches that have actually been paid. See `BatchPaymentsView`. */
export const PAID_LABEL = "Already included in bank transactions. Not additional.";
export const SCHEDULED_LABEL = "Scheduled, not yet paid. Not in bank transactions yet.";

/**
 * Every state the card can be in, as data.
 *
 * A discriminated union rather than a bag of optional fields: "failed" and "ready with zero
 * batches" must be impossible to confuse, and a union makes that a type error rather than a
 * convention.
 */
export type BatchPaymentsView =
  | { kind: "SCOPE_MISSING" }
  | { kind: "TRUNCATED" }
  | { kind: "FAILED"; detail: string }
  | { kind: "READY"; card: BatchPaymentCard; windowSince: string; windowDays: number };

/** Rendered rows per section. One call returns the window, so this is a display cap only. */
export const MAX_ROWS = 100;

export function BatchPaymentsView({ view }: { view: BatchPaymentsView }) {
  if (view.kind === "SCOPE_MISSING") {
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

  if (view.kind === "TRUNCATED") {
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

  if (view.kind === "FAILED") {
    return (
      <Shell>
        <Notice tone="error" title="Batch payments could not be read">
          <p>{view.detail}</p>
          <p className="mt-2">
            Nothing is shown rather than zeros — a failed read and an empty window look
            identical once they have both been rendered as 0.
          </p>
        </Notice>
      </Shell>
    );
  }

  const { card, windowSince, windowDays } = view;

  return (
    <Card
      title={CARD_TITLE}
      subtitle={
        <>
          AUTHORISED batches dated on or after {windowSince} ({windowDays} days). PAYBATCH =
          money out · RECBATCH = money in. Member counts come from the payments nested in each
          batch, not from a second read.
        </>
      }
    >
      <Section
        heading="Paid"
        label={PAID_LABEL}
        tone="paid"
        rows={card.rows}
        subtotals={card.subtotals}
        emptyMessage={`No paid AUTHORISED batch payments dated on or after ${windowSince}.`}
        note="Subtotals are grouped by currency and by direction, and never summed across either. Money in and money out are different facts; one combined figure would net a supplier run against a customer receipt. Neither of these subtotals feeds the cash position."
      />

      {card.scheduled.length > 0 ? (
        <Section
          heading="Scheduled"
          label={SCHEDULED_LABEL}
          tone="scheduled"
          rows={card.scheduled}
          subtotals={card.scheduledSubtotals}
          emptyMessage=""
          note="Dated after today, so this money has not moved and is in no bank read yet. Shown separately and never added to the paid subtotals above — the window has a lower bound only, so a scheduled batch falls inside it."
        />
      ) : null}

      <div className="space-y-4 border-t border-border px-5 py-4">
        <IntegrityBucket card={card} />
        <MemberCountFlag card={card} />
        {card.failures.length > 0 ? (
          <Notice tone="error" title={`${card.failures.length} batch(es) could not be read`}>
            <ul className="list-disc space-y-1 pl-5">
              {card.failures.slice(0, 10).map((failure, index) => (
                <li key={`${failure.externalId ?? "unknown"}-${index}`}>
                  <span className="figure">{failure.externalId ?? "(no id)"}</span> —{" "}
                  {failure.reason}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              These are excluded from every subtotal above, and reported rather than dropped.
            </p>
          </Notice>
        ) : null}
      </div>
    </Card>
  );
}

function Section({
  heading,
  label,
  tone,
  rows,
  subtotals,
  emptyMessage,
  note,
}: {
  heading: string;
  label: string;
  tone: "paid" | "scheduled";
  rows: readonly BatchPaymentRow[];
  subtotals: readonly BatchCurrencySubtotal[];
  emptyMessage: string;
  note: string;
}) {
  return (
    <section className={tone === "scheduled" ? "border-t border-border" : undefined}>
      <header className="px-5 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
          {heading}
        </h3>
        <p className="mt-1 text-xs text-muted">
          <strong className="text-primary">{label}</strong>
        </p>
      </header>

      {rows.length === 0 ? (
        <Empty>{emptyMessage}</Empty>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            {subtotals.map((subtotal) => (
              <SubtotalPair key={subtotal.currency} subtotal={subtotal} />
            ))}
          </dl>
          <p className="px-5 py-3 text-xs text-muted">{note}</p>
          <Table head={["Date", "Direction", "Status", "Payments", "Total"]}>
            {rows.slice(0, MAX_ROWS).map((row) => (
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
                  {row.memberCount === MEMBER_COUNT_TO_FLAG ? (
                    <span className="ml-2">
                      <Pill label="exactly 200" tone="warn" />
                    </span>
                  ) : null}
                </Cell>
                <Cell align="right">
                  <Figure value={row.total} />
                </Cell>
              </Row>
            ))}
          </Table>
          {rows.length > MAX_ROWS ? (
            <p className="px-5 py-3 text-xs text-muted">
              Showing the first {MAX_ROWS} of {rows.length}.
            </p>
          ) : null}
        </>
      )}
    </section>
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
        <code>BankAmount</code>.
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
            <span className="figure">{formatDay(row.paidAt)}</span>
            {row.isScheduled ? " (scheduled)" : null} — {row.tieReason}
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

/**
 * The round-number flag.
 *
 * Both of the live 200-member batches were read individually and are genuinely 200, so this
 * is not an error state — it is the one thing the integrity bucket cannot catch, because a
 * silently capped member list would still sum to whatever it contained.
 */
function MemberCountFlag({ card }: { card: BatchPaymentCard }) {
  if (card.memberCountFlagged.length === 0) return null;
  return (
    <Notice
      tone="info"
      title={`${card.memberCountFlagged.length} batch(es) hold exactly ${MEMBER_COUNT_TO_FLAG} payments`}
    >
      <ul className="list-disc space-y-1 pl-5">
        {card.memberCountFlagged.slice(0, 10).map((row) => (
          <li key={row.externalId}>
            <span className="figure">{formatDay(row.paidAt)}</span> —{" "}
            <span className="figure">{row.externalId}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2">
        Exactly {MEMBER_COUNT_TO_FLAG} is the shape a silent per-batch member cap would take.
        Both of the batches seen so far were confirmed genuine by reading them individually,
        and their members tie to their totals — but a cap would tie too, so this is surfaced
        for a human to confirm rather than assumed either way.
      </p>
    </Notice>
  );
}

/**
 * One tile per direction that actually has batches.
 *
 * A direction with no batches is omitted rather than rendered as 0.00. Caught by the render
 * test: a section holding only outgoing batches printed "GBP in · 0 batch(es) — 0.00 GBP"
 * next to the real figure, which is a zero standing where there is no data at all — the one
 * thing this card is not allowed to do.
 */
function SubtotalPair({ subtotal }: { subtotal: BatchCurrencySubtotal }) {
  return (
    <>
      {subtotal.inflowCount > 0 ? (
        <Stat
          label={`${subtotal.currency} in · ${subtotal.inflowCount} batch(es)`}
          value={<Figure value={subtotal.inflow} />}
        />
      ) : null}
      {subtotal.outflowCount > 0 ? (
        <Stat
          label={`${subtotal.currency} out · ${subtotal.outflowCount} batch(es)`}
          value={<Figure value={subtotal.outflow} />}
        />
      ) : null}
    </>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-primary">{value}</dd>
    </div>
  );
}

/**
 * The card chrome for every state that has no figures to show.
 *
 * The paid label is NOT used here: with nothing read, "already included in bank transactions"
 * would be a claim about data this card does not have.
 */
function Shell({ children }: { children: ReactNode }) {
  return (
    <Card title={CARD_TITLE}>
      <div className="px-5 py-4">{children}</div>
    </Card>
  );
}

/** What the page shows while the batch read is in flight. */
export function BatchPaymentsCardSkeleton() {
  return (
    <Card title={CARD_TITLE}>
      <Empty>Reading batch payments…</Empty>
    </Card>
  );
}
