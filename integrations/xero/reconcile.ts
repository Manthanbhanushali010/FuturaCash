import { add, money, type CurrencyCode, type Money } from "../../core/money";
import type { CommitmentDirection, NormalisedCommitment } from "../types";
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
  const counted = new Map<ReconciliationSource, CurrencyBucket>();
  const excluded = new Map<string, { reason: ExclusionReason; source: ReconciliationSource; bucket: CurrencyBucket }>();
  const presented = new Map<ReconciliationSource, CurrencyBucket>();
  const movement: Record<CommitmentDirection, CurrencyBucket> = {
    INFLOW: new CurrencyBucket(),
    OUTFLOW: new CurrencyBucket(),
  };
  const credit = new CurrencyBucket();
  const discrepancies: string[] = [];
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

  const count = (source: ReconciliationSource, amount: Money, direction: CommitmentDirection) => {
    bucketFor(counted, source).addMoney(amount);
    movement[direction].addMoney(amount);
  };

  // --- batch payments ------------------------------------------------------
  // Counted FIRST, because which payments are duplicates depends on which batches survived.
  const countedBatchIds = new Set<string>();
  const batchMemberIds = new Set<string>();
  for (const batch of input.batchPayments) {
    bucketFor(presented, "BATCH_PAYMENT").addMoney(batch.amount);
    if (!batch.amountIsLive) {
      exclude("BATCH_PAYMENT", "CANCELLED", batch.amount);
      continue;
    }
    countedBatchIds.add(batch.externalId);
    for (const id of batch.memberPaymentIds) batchMemberIds.add(id);
    count("BATCH_PAYMENT", batch.amount, batch.direction);
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
    count("PAYMENT", amount, payment.direction);
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
      count(source, record.amount, record.direction);
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

    count("BANK_TRANSACTION", transaction.total, transaction.direction);
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
    const excludedBuckets = [...excluded.values()].filter((e) => e.source === source);

    const totalRecords =
      (countedBucket?.count ?? 0) + excludedBuckets.reduce((n, e) => n + e.bucket.count, 0);
    if (totalRecords !== incoming.count) {
      discrepancies.push(
        `${source}: ${incoming.count} records in, ${totalRecords} accounted for — ${incoming.count - totalRecords} unclassified.`,
      );
    }

    for (const currency of incoming.currencies) {
      const accounted =
        (countedBucket?.minorFor(currency) ?? 0) +
        excludedBuckets.reduce((n, e) => n + e.bucket.minorFor(currency), 0);
      if (accounted !== incoming.minorFor(currency)) {
        discrepancies.push(
          `${source} ${currency}: ${incoming.minorFor(currency)} minor units in, ${accounted} accounted for — differs by ${incoming.minorFor(currency) - accounted}.`,
        );
      }
    }
  }

  return {
    movement: { INFLOW: movement.INFLOW.byCurrency, OUTFLOW: movement.OUTFLOW.byCurrency },
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
    tiesOut: discrepancies.length === 0,
    discrepancies,
    warnings,
  };
}
