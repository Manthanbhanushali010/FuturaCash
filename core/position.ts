import { add, money, type CurrencyCode, type Money } from "./money";
import type { CommitmentDirection, CommitmentStatus, NormalisedCommitment } from "../integrations/types";

/**
 * Derived views over commitments. Pure functions on the normalised model — no provider
 * knowledge, no I/O (invariant #6), so every figure here is assertable in evals.
 *
 * This is only the committed half of the cash position. Cleared cash from bank feeds joins
 * it in Spec 2; consolidating the two is where reconciliation lives.
 */

/**
 * Statuses that represent cash we can actually expect to move.
 *
 * DRAFT is excluded because a draft is not an obligation yet; PAID is excluded because it
 * has already moved and would double-count against the bank feed. VOIDED and DELETED are
 * not commitments at all.
 */
const COUNTED_STATUSES: readonly CommitmentStatus[] = ["AUTHORISED", "SUBMITTED"];

export type OutstandingByDirection = Record<CommitmentDirection, Money[]>;

/**
 * Total outstanding per direction, grouped by currency.
 *
 * Grouped rather than totalled: summing GBP into EUR without an explicit rate is precisely
 * the confidently-wrong number invariant #4 exists to prevent. Callers that need a single
 * figure must convert deliberately, with a rate they can show.
 */
export function outstandingByDirection(
  commitments: readonly NormalisedCommitment[],
): OutstandingByDirection {
  const buckets: Record<CommitmentDirection, Map<CurrencyCode, Money>> = {
    INFLOW: new Map(),
    OUTFLOW: new Map(),
  };

  for (const commitment of commitments) {
    if (!COUNTED_STATUSES.includes(commitment.status)) continue;
    if (commitment.amountDue.minor === 0) continue;

    const bucket = buckets[commitment.direction];
    const currency = commitment.amountDue.currency;
    bucket.set(currency, add(bucket.get(currency) ?? money(0, currency), commitment.amountDue));
  }

  return {
    INFLOW: sortByCurrency(buckets.INFLOW),
    OUTFLOW: sortByCurrency(buckets.OUTFLOW),
  };
}

/** Stable order so the same data always renders the same way. */
function sortByCurrency(bucket: Map<CurrencyCode, Money>): Money[] {
  return [...bucket.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
