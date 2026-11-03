import { add, money, type CurrencyCode, type Money } from "../../core/money";
import type { CommitmentDirection, NormalisedCommitment } from "../types";
import { assertCalendarDate, toCalendarDay } from "./dates";
import type { NormalisedBankTransaction, NormalisedProviderPayment } from "./types";

/**
 * Cross-endpoint reconciliation: does Xero's own data, read across five endpoints, account
 * for everything once?
 *
 * PURE. No I/O, no provider calls, nothing wired to a screen. Every figure here is derivable
 * from its inputs, which is what makes the numbers arguable rather than merely plausible.
 *
 * It lives in `integrations/xero/` rather than `core/` because what it reconciles is an
 * artefact of how Xero models money, not of how a business thinks about cash: five endpoints
 * that overlap in three specific ways, each discovered by measurement. When a second provider
 * arrives, the overlaps will be different and this will not generalise.
 *
 * THE DESIGN RULE: every input record lands in exactly one bucket — counted, or excluded with
 * a named reason. Nothing is dropped quietly. `tiesOut` proves it arithmetically rather than
 * asking to be trusted, because a reconciliation that cannot show its own completeness is
 * indistinguishable from one that is wrong.
 */

export type ExclusionReason =
  /** Cancelled, but Xero still reports an amount. `amountIsLive` is false. */
  | "CANCELLED"
  /** Already counted inside its batch payment. */
  | "BATCH_MEMBER"
  /** Already present in the bank read as a SPEND/RECEIVE-OVERPAYMENT row. */
  | "OVERPAYMENT_ALREADY_IN_BANK"
  /** Money between the business's own accounts. Deliberately out of scope tonight. */
  | "INTERNAL_TRANSFER";

export type ReconciliationSource =
  | "PAYMENT"
  | "BATCH_PAYMENT"
  | "OVERPAYMENT"
  | "PREPAYMENT"
  | "BANK_TRANSACTION";

export interface SourceTotal {
  source: ReconciliationSource;
  count: number;
  /** Grouped by currency, never summed across. Totalling GBP into USD invents a number. */
  byCurrency: Money[];
}

export interface ExclusionTotal extends SourceTotal {
  reason: ExclusionReason;
}

/**
 * A named slice of the reconciled span, for period-over-period comparison.
 *
 * Periods exist because subtracting two reconciliations is NOT arithmetic, however obvious it
 * looks. Two separate reads end at two different "now"s, so transactions land between them;
 * and each read dedupes independently, so a batch counted in the wider window can have its
 * member payments excluded in the narrower one. Attributing a SINGLE deduped set to periods
 * avoids both: one read, one dedupe, slices that sum exactly to the whole.
 */
export interface ReconciliationPeriod {
  label: string;
  /**
   * Inclusive, ISO 8601, and it must be DAY-ALIGNED.
   *
   * `toXeroDateTime` truncates a fetch bound to midnight UTC, so every record on a boundary
   * day arrives with a 00:00 timestamp. A period bound carrying a time of day therefore sits
   * AFTER those records and pushes a whole day into the wrong slice — observed on the first
   * live run as 13 records and £14,822 landing in `unattributed`. Prefer a date-only string
   * (`"2026-09-24"`), which compares correctly against a full ISO timestamp.
   */
  since: string;
  /** Exclusive, ISO 8601, day-aligned for the same reason. Omitted means "to the end". */
  until?: string;
}

export interface PeriodMovement {
  label: string;
  movement: Record<CommitmentDirection, Money[]>;
  /** Counted records attributed to this period. */
  count: number;
}

/**
 * A batch whose total does not equal the sum of its member payments.
 *
 * TWO CAUSES, and conflating them would be the bug. A batch dated inside the window whose
 * members fall OUTSIDE it is a window artefact — the arithmetic is fine, we simply cannot see
 * all the parts. A batch whose members are all present and still disagree is a genuine data
 * integrity problem. Only the second should ever be non-empty, and reporting them in one
 * bucket would make a window edge look like a defect every month.
 */
export interface BatchMismatch {
  batchExternalId: string;
  /** The batch's own total. */
  batchAmount: Money;
  /** Sum of the member payments that were found in this read. */
  memberAmount: Money;
  /** Member ids the batch names that were not present. Non-empty means window artefact. */
  missingMemberIds: string[];
}

export interface Reconciliation {
  /** Cash that moved, per direction, grouped by currency. */
  movement: Record<CommitmentDirection, Money[]>;
  /** What each source contributed after deduplication. */
  counted: SourceTotal[];
  /** What was removed, why, and how much — itemised so no exclusion hides inside a total. */
  excluded: ExclusionTotal[];
  /**
   * Outstanding commitments, kept DELIBERATELY OUT of `movement`.
   *
   * An invoice is an obligation; a payment is its settlement. Adding both to one cash figure
   * counts the same money twice — once when it was promised and again when it moved. They are
   * reported side by side so the relationship is visible instead of resolved by addition.
   */
  committed: Record<CommitmentDirection, Money[]>;
  /**
   * Credit sitting unapplied — real money with nothing matched against it yet. Gated on
   * `creditIsLive`, because VOIDED records keep a stale `remainingCredit`.
   */
  availableCredit: Money[];
  /**
   * Counted cash movement sliced by period, when periods were supplied.
   *
   * Derived from the SAME deduped set as `movement`, so the slices sum to it exactly —
   * including `unattributed`, which holds counted records falling outside every period rather
   * than letting them disappear from the breakdown.
   */
  /**
   * Batches whose members are all present and still do not sum to the batch total.
   *
   * MUST BE EMPTY. A non-empty list means the dedupe removed an amount different from the one
   * it counted, so the movement figure is wrong by the difference.
   */
  batchMismatches: BatchMismatch[];
  /**
   * Batches whose members are not all inside the read. NOT a defect — a window edge.
   *
   * Reported separately so that a batch straddling the boundary is never mistaken for a data
   * integrity failure, which is what a single combined bucket would do every month.
   */
  batchesWithMembersOutsideWindow: BatchMismatch[];
  byPeriod: PeriodMovement[];
  /** Counted records that fell in no supplied period. Null when every one was attributed. */
  unattributed: PeriodMovement | null;
  /**
   * Records dated AFTER `asOf`: authorised, but the money has not moved yet.
   *
   * A third category alongside `counted` and `excluded`, not a kind of exclusion, because the
   * two answer different questions. An exclusion says "this is a duplicate or a cancellation,
   * do not count it"; this says "this is real and singular, but it is in the future". Folding
   * them together would make a scheduled supplier run indistinguishable from a voided one.
   *
   * Measured on JENKI, 2026-10-27: two scheduled batches worth 100,324.65 GBP were being
   * counted as OUTFLOW, understating net movement by that amount.
   */
  scheduled: SourceTotal[];
  /** Scheduled cash, per direction. Deliberately NOT added to `movement`. */
  scheduledMovement: Record<CommitmentDirection, Money[]>;
  /**
   * The calendar date this reconciliation treated as "today", echoed back.
   *
   * Reported because every figure here depends on it. A stored snapshot without it cannot be
   * interpreted later: the same input reconciled against a different `asOf` yields a
   * different net, and nothing about the numbers themselves reveals which day was used.
   */
  asOf: string;
  /**
   * True when, for every source, counted + excluded equals everything that came in — by
   * record count and by amount, in every currency.
   */
  tiesOut: boolean;
  /**
   * ARITHMETIC failures only: a source where counted + excluded did not equal what came in.
   * These drive `tiesOut`, and a non-empty list means a figure here is untrustworthy.
   */
  discrepancies: string[];
  /**
   * Advisory notes. The numbers still tie, but something is worth knowing — a payment naming
   * a batch outside this read, for instance. Kept separate from `discrepancies` so that a
   * caveat cannot masquerade as a broken total, or a broken total hide among caveats.
   */
  warnings: string[];
}

/** Records that never reached the reconciliation because normalisation rejected them. */
export interface SourceFailures {
  source: ReconciliationSource;
  count: number;
}

export interface ReconciliationInput {
  /**
   * The organisation's calendar date — `YYYY-MM-DD` — treated as "today". REQUIRED.
   *
   * INJECTED, never read from the clock in here. Two reasons, and both have already cost
   * something on this project. A function that reads the clock cannot be tested against a
   * boundary, and a figure computed from an unrecorded clock cannot be reproduced.
   *
   * IT MUST BE COMPUTED IN THE ORGANISATION'S TIMEZONE, not UTC — see `calendarDateIn` and
   * `orgTimeZone`. JENKI is Europe/London, which is UTC+1 for seven months a year, so between
   * midnight and 01:00 BST the UK day and the UTC day differ and a UTC-derived date classifies
   * a whole day's real trading as scheduled for the future.
   *
   * A calendar date and not a timestamp, deliberately. Xero stamps a record's date at midnight,
   * so comparing days avoids the off-by-a-day that a time-of-day bound produces — the same
   * defect that put £62k in the wrong period slice.
   */
  asOf: string;
  payments: readonly NormalisedProviderPayment[];
  batchPayments: readonly NormalisedProviderPayment[];
  overpayments: readonly NormalisedProviderPayment[];
  prepayments: readonly NormalisedProviderPayment[];
  bankTransactions: readonly NormalisedBankTransaction[];
  commitments: readonly NormalisedCommitment[];
  /**
   * Normalisation failures per source, if any.
   *
   * Passed in because a reconciliation cannot otherwise see them, and without them `tiesOut`
   * is a lie of omission: the arithmetic over what arrived can balance perfectly while whole
   * endpoints are missing. This was not hypothetical — all 534 of JENKI's overpayments once
   * failed on an unrecognised type, and the reconciliation reported tiesOut: true over a set
   * that silently excluded every one of them.
   */
  /**
   * Optional period slices. Supply them in the order you want them reported; overlapping
   * periods would double-count, so the FIRST match wins and that is deliberate.
   */
  periods?: readonly ReconciliationPeriod[];
  failures?: readonly SourceFailures[];
  /**
   * Sources whose read hit its page bound, so more records exist than were seen.
   *
   * Not an arithmetic fault, so it does not break `tiesOut` — but it is the difference
   * between "these totals are internally consistent" and "these totals are the whole truth",
   * and that difference has to be stated rather than inferred. A bounded read summed next to
   * a complete one produces a figure with no coherent period, which is the most plausible way
   * for everything here to be individually correct and collectively misleading.
   */
  truncated?: readonly ReconciliationSource[];
}

/** Accumulates money per currency so nothing is ever added across currencies. */
class CurrencyBucket {
  private readonly totals = new Map<CurrencyCode, Money>();
  private records = 0;

  addMoney(amount: Money): void {
    this.totals.set(
      amount.currency,
      add(this.totals.get(amount.currency) ?? money(0, amount.currency), amount),
    );
    this.records += 1;
  }

  get count(): number {
    return this.records;
  }

  get byCurrency(): Money[] {
    return [...this.totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  }

  minorFor(currency: CurrencyCode): number {
    return this.totals.get(currency)?.minor ?? 0;
  }

  get currencies(): CurrencyCode[] {
    return [...this.totals.keys()];
  }
}

/** A bank transaction's type tells you whether it is an internal transfer. */
function isInternalTransfer(transaction: NormalisedBankTransaction): boolean {
  return transaction.providerType.endsWith("-TRANSFER");
}

function isCancelled(status: string): boolean {
  return status === "VOIDED" || status === "DELETED";
}

export function reconcile(input: ReconciliationInput): Reconciliation {
  const asOf = assertCalendarDate(input.asOf, "asOf");
  const counted = new Map<ReconciliationSource, CurrencyBucket>();
  const scheduled = new Map<ReconciliationSource, CurrencyBucket>();
  const excluded = new Map<string, { reason: ExclusionReason; source: ReconciliationSource; bucket: CurrencyBucket }>();
  const presented = new Map<ReconciliationSource, CurrencyBucket>();
  const movement: Record<CommitmentDirection, CurrencyBucket> = {
    INFLOW: new CurrencyBucket(),
    OUTFLOW: new CurrencyBucket(),
  };
  const credit = new CurrencyBucket();
  const scheduledMovement: Record<CommitmentDirection, CurrencyBucket> = {
    INFLOW: new CurrencyBucket(),
    OUTFLOW: new CurrencyBucket(),
  };
  const discrepancies: string[] = [];

  // Period buckets, built once so attribution is a lookup rather than a second pass over the
  // data. `unattributed` exists so the slices always sum to `movement`: a counted record that
  // matches no period is reported, never dropped.
  const periods = input.periods ?? [];
  const periodBuckets = periods.map((period) => ({
    period,
    buckets: {
      INFLOW: new CurrencyBucket(),
      OUTFLOW: new CurrencyBucket(),
    } as Record<CommitmentDirection, CurrencyBucket>,
    count: 0,
  }));
  const unattributedBuckets = {
    INFLOW: new CurrencyBucket(),
    OUTFLOW: new CurrencyBucket(),
  } as Record<CommitmentDirection, CurrencyBucket>;
  let unattributedCount = 0;

  const attribute = (occurredAt: string | null, amount: Money, direction: CommitmentDirection) => {
    if (periods.length === 0) return;
    // FIRST match wins. Overlapping periods would otherwise double-count, and a silent
    // double-count is the one outcome this whole module exists to prevent.
    const hit = periodBuckets.find(
      ({ period }) =>
        occurredAt !== null &&
        occurredAt >= period.since &&
        (period.until === undefined || occurredAt < period.until),
    );
    if (hit) {
      hit.buckets[direction].addMoney(amount);
      hit.count += 1;
      return;
    }
    // Includes records with no date at all: undated money is still money, and hiding it in a
    // period it cannot be shown to belong to would be worse than reporting it unattributed.
    unattributedBuckets[direction].addMoney(amount);
    unattributedCount += 1;
  };
  const warnings: string[] = [];

  const bucketFor = (map: Map<ReconciliationSource, CurrencyBucket>, source: ReconciliationSource) => {
    const existing = map.get(source);
    if (existing) return existing;
    const created = new CurrencyBucket();
    map.set(source, created);
    return created;
  };

  const exclude = (source: ReconciliationSource, reason: ExclusionReason, amount: Money) => {
    const key = `${source}:${reason}`;
    const entry = excluded.get(key) ?? { reason, source, bucket: new CurrencyBucket() };
    entry.bucket.addMoney(amount);
    excluded.set(key, entry);
  };

  /**
   * Is this record dated after the organisation's today?
   *
   * Compared as calendar days, so a record Xero stamped 2026-10-27T00:00:00Z is "today" on
   * 2026-10-27 rather than "the start of today and therefore past". An undated record is
   * NOT treated as scheduled: it cannot be shown to be in the future, and quietly moving
   * money out of the counted total on a guess is the opposite of what this module is for.
   */
  const isScheduled = (occurredAt: string | null): boolean =>
    occurredAt !== null && toCalendarDay(occurredAt) > asOf;

  const count = (
    source: ReconciliationSource,
    amount: Money,
    direction: CommitmentDirection,
    occurredAt: string | null,
    externalId: string,
  ) => {
    // An undated record is counted, not guessed into the future — but it is never silent.
    //
    // It cannot be placed in a period, it cannot be tested against `asOf`, and it is the one
    // record whose classification rests on an absence rather than a value. Counting it is the
    // conservative choice (money that exists should appear in the total); saying so is what
    // stops that choice from looking like a measurement. Live, every record carries a date,
    // so a non-empty count here means Xero sent something new.
    if (occurredAt === null) {
      warnings.push(
        `${source} ${externalId}: no date, so it could not be tested against asOf ${asOf} or attributed to a period — counted as money that has already moved.`,
      );
    }
    // Routed HERE, at the point of counting, rather than by filtering the input — and that
    // distinction is the whole fix. Removing future-dated records before the dedupe measurably
    // changes nothing: a scheduled batch dropped from the input no longer appears in
    // `countedBatchIds` or `batchMemberIds`, so its 139 member payments stop being recognised
    // as duplicates and are counted individually instead. Measured on JENKI 2026-10-27, that
    // left OUT at 1,097,744.28 GBP exactly as before, moving 100,324.65 GBP from BATCH_PAYMENT
    // into PAYMENT and emitting 139 warnings. The dedupe must see every record; only the
    // counting decision may depend on the date.
    if (isScheduled(occurredAt)) {
      bucketFor(scheduled, source).addMoney(amount);
      scheduledMovement[direction].addMoney(amount);
      // No `attribute` call: a scheduled record must not land in a period slice, or the
      // period total inflates by money that has not moved.
      return;
    }
    bucketFor(counted, source).addMoney(amount);
    movement[direction].addMoney(amount);
    attribute(occurredAt, amount, direction);
  };

  // --- batch payments ------------------------------------------------------
  // Counted FIRST, because which payments are duplicates depends on which batches survived.
  const countedBatchIds = new Set<string>();
  const batchMemberIds = new Set<string>();
  /** batchId -> the batch, so its total can be checked against its members afterwards. */
  const countedBatches = new Map<string, { amount: Money; memberIds: string[] }>();
  /** memberPaymentId -> batchId, so a member can be attributed even without batchExternalId. */
  const memberToBatch = new Map<string, string>();
  /** batchId -> summed amounts of the member payments actually seen in this read. */
  const memberTotals = new Map<string, CurrencyBucket>();
  /** batchId -> member ids actually seen. */
  const membersSeen = new Map<string, Set<string>>();

  for (const batch of input.batchPayments) {
    bucketFor(presented, "BATCH_PAYMENT").addMoney(batch.amount);
    if (!batch.amountIsLive) {
      exclude("BATCH_PAYMENT", "CANCELLED", batch.amount);
      continue;
    }
    countedBatchIds.add(batch.externalId);
    for (const id of batch.memberPaymentIds) {
      batchMemberIds.add(id);
      memberToBatch.set(id, batch.externalId);
    }
    countedBatches.set(batch.externalId, {
      amount: batch.amount,
      memberIds: batch.memberPaymentIds,
    });
    count("BATCH_PAYMENT", batch.amount, batch.direction, batch.paidAt, batch.externalId);
  }

  // --- individual payments ------------------------------------------------
  for (const payment of input.payments) {
    // bankAmount, not amount: under a currency rate they differ, and this is the figure the
    // statement will show. See NormalisedProviderPayment.bankAmount.
    const amount = payment.bankAmount;
    bucketFor(presented, "PAYMENT").addMoney(amount);

    if (!payment.amountIsLive) {
      exclude("PAYMENT", "CANCELLED", amount);
      continue;
    }

    // Two independent keys for the same overlap, because either side may be the one Xero
    // populated: the payment names its batch, and the batch lists its members.
    const namesCountedBatch = payment.batchExternalId !== null && countedBatchIds.has(payment.batchExternalId);
    const listedByBatch = batchMemberIds.has(payment.externalId);
    if (namesCountedBatch || listedByBatch) {
      exclude("PAYMENT", "BATCH_MEMBER", amount);
      // Attribute the excluded member so the batch's total can be checked against the parts
      // that were actually removed. Either join direction can be the one Xero populated.
      const batchId = payment.batchExternalId ?? memberToBatch.get(payment.externalId);
      if (batchId !== undefined) {
        const bucket = memberTotals.get(batchId) ?? new CurrencyBucket();
        bucket.addMoney(amount);
        memberTotals.set(batchId, bucket);
        const seen = membersSeen.get(batchId) ?? new Set<string>();
        seen.add(payment.externalId);
        membersSeen.set(batchId, seen);
      }
      continue;
    }

    // A payment naming a batch we never read is NOT excluded. Dropping it would hide real
    // money behind an assumption about data we do not have; counting it risks a double-count
    // that is at least visible as a discrepancy.
    if (payment.batchExternalId !== null) {
      warnings.push(
        `Payment ${payment.externalId} names batch ${payment.batchExternalId}, which is not in this read — counted individually, so it may double-count if that batch is read separately.`,
      );
    }
    count("PAYMENT", amount, payment.direction, payment.paidAt, payment.externalId);
  }

  // --- unallocated credit -------------------------------------------------
  // Which bank rows are duplicates depends on which overpayments are present, so the link
  // set is built here and consumed by the bank pass below.
  const overpaymentIdsPresent = new Set<string>();
  for (const [source, records] of [
    ["OVERPAYMENT", input.overpayments],
    ["PREPAYMENT", input.prepayments],
  ] as const) {
    for (const record of records) {
      bucketFor(presented, source).addMoney(record.amount);
      overpaymentIdsPresent.add(record.externalId);
      if (!record.amountIsLive) {
        exclude(source, "CANCELLED", record.amount);
        continue;
      }
      count(source, record.amount, record.direction, record.paidAt, record.externalId);
      // Separate from movement: this is money sitting unapplied, not money that moved today.
      if (record.creditIsLive) credit.addMoney(record.remainingCredit);
    }
  }

  // --- bank transactions --------------------------------------------------
  for (const transaction of input.bankTransactions) {
    bucketFor(presented, "BANK_TRANSACTION").addMoney(transaction.total);

    if (isCancelled(transaction.providerStatus)) {
      exclude("BANK_TRANSACTION", "CANCELLED", transaction.total);
      continue;
    }

    // Transfers are excluded, loudly. A transfer between the business's own accounts appears
    // twice, once each way, so including them inflates a net total by double the transfer
    // volume. Netting the pairs properly is a separate job; until then the exclusion is
    // reported with its own total so nobody mistakes this for a complete cash picture.
    if (isInternalTransfer(transaction)) {
      exclude("BANK_TRANSACTION", "INTERNAL_TRANSFER", transaction.total);
      continue;
    }

    // The same money as an /Overpayments record. The overpayment is kept rather than the bank
    // row because it carries the allocations and remaining credit that say what became of it;
    // the bank row carries only the movement. Matching is on the link field, never the
    // primary key — Xero gives the bank row a different id from the overpayment.
    const link = transaction.overpaymentExternalId ?? transaction.prepaymentExternalId;
    if (link !== null && overpaymentIdsPresent.has(link)) {
      exclude("BANK_TRANSACTION", "OVERPAYMENT_ALREADY_IN_BANK", transaction.total);
      continue;
    }

    count(
      "BANK_TRANSACTION",
      transaction.total,
      transaction.direction,
      transaction.bookedAt,
      transaction.externalId,
    );
  }

  // --- requirement 6: does each batch equal the members we removed for it? ----
  // Split deliberately. A batch whose members are not all in the read is a WINDOW EDGE, not a
  // defect; a batch whose members are all present and still disagree means the dedupe removed
  // a different amount from the one it counted, so `movement` is wrong by the difference.
  const batchMismatches: BatchMismatch[] = [];
  const batchesWithMembersOutsideWindow: BatchMismatch[] = [];

  for (const [batchExternalId, batch] of countedBatches) {
    // A batch naming no members cannot be checked either way. Skipped rather than reported,
    // because "unverifiable" is not the same as "wrong" and 5% of JENKI's batches are this.
    if (batch.memberIds.length === 0) continue;

    const seen = membersSeen.get(batchExternalId) ?? new Set<string>();
    const missingMemberIds = batch.memberIds.filter((id) => !seen.has(id));
    const bucket = memberTotals.get(batchExternalId) ?? new CurrencyBucket();
    const memberMinor = bucket.minorFor(batch.amount.currency);
    const memberAmount = money(memberMinor, batch.amount.currency);

    if (missingMemberIds.length > 0) {
      batchesWithMembersOutsideWindow.push({
        batchExternalId,
        batchAmount: batch.amount,
        memberAmount,
        missingMemberIds,
      });
      continue;
    }
    if (memberMinor !== batch.amount.minor) {
      batchMismatches.push({
        batchExternalId,
        batchAmount: batch.amount,
        memberAmount,
        missingMemberIds: [],
      });
    }
  }

  // A real mismatch means the counted and removed amounts differ, so the movement figure is
  // wrong. That is an arithmetic failure, not a note.
  for (const mismatch of batchMismatches) {
    discrepancies.push(
      `Batch ${mismatch.batchExternalId}: total ${mismatch.batchAmount.minor} minor units but ` +
        `its member payments sum to ${mismatch.memberAmount.minor} — every member was present, ` +
        `so movement is wrong by ${mismatch.batchAmount.minor - mismatch.memberAmount.minor}.`,
    );
  }

  // --- commitments, reported but never added to movement -------------------
  const committed: Record<CommitmentDirection, CurrencyBucket> = {
    INFLOW: new CurrencyBucket(),
    OUTFLOW: new CurrencyBucket(),
  };
  for (const commitment of input.commitments) {
    if (commitment.status !== "AUTHORISED" && commitment.status !== "SUBMITTED") continue;
    if (commitment.amountDue.minor === 0) continue;
    committed[commitment.direction].addMoney(commitment.amountDue);
  }

  for (const source of input.truncated ?? []) {
    warnings.push(
      `${source}: the read hit its page bound, so this total covers only the most recent records, not the full history. Summing it alongside a complete source gives a figure with no consistent period.`,
    );
  }

  // Upstream drop-out first: anything rejected before reaching here makes completeness
  // unprovable, however neatly the rest adds up.
  for (const failure of input.failures ?? []) {
    if (failure.count > 0) {
      discrepancies.push(
        `${failure.source}: ${failure.count} record(s) failed normalisation and never reached the reconciliation, so these totals are over an incomplete set.`,
      );
    }
  }

  // --- does it tie out? ---------------------------------------------------
  // Per source: counted + excluded must equal what came in, by count and by amount, in every
  // currency. This is the whole point. A reconciliation that cannot prove its own
  // completeness has only moved the uncertainty somewhere less visible.
  for (const [source, incoming] of presented) {
    const countedBucket = counted.get(source);
    const scheduledBucket = scheduled.get(source);
    const excludedBuckets = [...excluded.values()].filter((e) => e.source === source);

    // counted + excluded + SCHEDULED. Adding a third category without extending this sum
    // would have let `tiesOut` stay true while scheduled money vanished from the accounting —
    // which is precisely the kind of silent hole the tie-out exists to make impossible.
    const totalRecords =
      (countedBucket?.count ?? 0) +
      (scheduledBucket?.count ?? 0) +
      excludedBuckets.reduce((n, e) => n + e.bucket.count, 0);
    if (totalRecords !== incoming.count) {
      discrepancies.push(
        `${source}: ${incoming.count} records in, ${totalRecords} accounted for — ${incoming.count - totalRecords} unclassified.`,
      );
    }

    for (const currency of incoming.currencies) {
      const accounted =
        (countedBucket?.minorFor(currency) ?? 0) +
        (scheduledBucket?.minorFor(currency) ?? 0) +
        excludedBuckets.reduce((n, e) => n + e.bucket.minorFor(currency), 0);
      if (accounted !== incoming.minorFor(currency)) {
        discrepancies.push(
          `${source} ${currency}: ${incoming.minorFor(currency)} minor units in, ${accounted} accounted for — differs by ${incoming.minorFor(currency) - accounted}.`,
        );
      }
    }
  }

  return {
    asOf,
    movement: { INFLOW: movement.INFLOW.byCurrency, OUTFLOW: movement.OUTFLOW.byCurrency },
    scheduledMovement: {
      INFLOW: scheduledMovement.INFLOW.byCurrency,
      OUTFLOW: scheduledMovement.OUTFLOW.byCurrency,
    },
    scheduled: [...scheduled.entries()]
      .map(([source, bucket]) => ({ source, count: bucket.count, byCurrency: bucket.byCurrency }))
      .sort((a, b) => a.source.localeCompare(b.source)),
    counted: [...counted.entries()]
      .map(([source, bucket]) => ({ source, count: bucket.count, byCurrency: bucket.byCurrency }))
      .sort((a, b) => a.source.localeCompare(b.source)),
    excluded: [...excluded.values()]
      .map(({ reason, source, bucket }) => ({
        source,
        reason,
        count: bucket.count,
        byCurrency: bucket.byCurrency,
      }))
      .sort((a, b) => `${a.source}${a.reason}`.localeCompare(`${b.source}${b.reason}`)),
    committed: { INFLOW: committed.INFLOW.byCurrency, OUTFLOW: committed.OUTFLOW.byCurrency },
    availableCredit: credit.byCurrency,
    batchMismatches,
    batchesWithMembersOutsideWindow,
    byPeriod: periodBuckets.map(({ period, buckets, count: n }) => ({
      label: period.label,
      movement: { INFLOW: buckets.INFLOW.byCurrency, OUTFLOW: buckets.OUTFLOW.byCurrency },
      count: n,
    })),
    unattributed:
      unattributedCount === 0
        ? null
        : {
            label: "unattributed",
            movement: {
              INFLOW: unattributedBuckets.INFLOW.byCurrency,
              OUTFLOW: unattributedBuckets.OUTFLOW.byCurrency,
            },
            count: unattributedCount,
          },
    tiesOut: discrepancies.length === 0,
    discrepancies,
    warnings,
  };
}
