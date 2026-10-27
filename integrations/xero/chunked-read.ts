import {
  RECONCILIATION_WINDOW_DAYS,
  XeroRateLimitError,
  fetchBankTransactions,
  fetchBatchPayments,
  fetchOverpayments,
  fetchPayments,
  fetchPrepayments,
  type DateWindow,
} from "./client";
import type {
  XeroBankTransaction,
  XeroBatchPayment,
  XeroPayment,
  XeroUnallocatedCredit,
} from "./schemas";

/**
 * Reads a span of history as a sequence of fixed 30-day chunks, each proven to read completely.
 *
 * WHY FIXED CHUNKS, AND NOT A COMPUTED SIZE. The 90-day attempt failed twice over: it tripped
 * a live 429, and when the call budget was not the problem it STILL truncated — the higher
 * volume sources (Payments, BankTransactions) ran past their page bound while the lower volume
 * ones (BatchPayments, Overpayments) came back complete. That mix is worse than plain
 * truncation, because a partially-read window is indistinguishable from a complete one.
 *
 * Computing a per-endpoint chunk size from measured record density is the same kind of
 * reasoning that produced that attempt: it is correct on the volumes observed on one day, and
 * silently wrong the week JENKI gets busier. 30 days is used because it has been MEASURED to
 * read completely for all four sources, not because it is optimal.
 *
 * ANY truncation in ANY source of ANY chunk is a hard failure for that chunk. Its records are
 * discarded, extending further back stops, and the result says where it stopped and why.
 * Keeping a partial chunk alongside complete ones is the exact failure this exists to prevent.
 */

export interface ChunkRecords {
  payments: XeroPayment[];
  batchPayments: XeroBatchPayment[];
  overpayments: XeroUnallocatedCredit[];
  prepayments: XeroUnallocatedCredit[];
  bankTransactions: XeroBankTransaction[];
}

/**
 * Page budget for a 30-day chunk, and the number is measured.
 *
 * JENKI runs ~32.6 payments/day, so a 30-day chunk holds ~980 — and the busiest observed
 * chunk held **1,042**. The shipped per-fetch default of 10 pages (1,000 records) is therefore
 * BELOW the real volume of the most recent month: at the default, payments truncate and the
 * chunk is discarded, so the page shows nothing rather than something wrong. Loud, but broken.
 *
 * 20 gives ~2x headroom on the worst month seen. Bank transactions are not the constraint —
 * 19.1/day, busiest chunk 799 — but they share the budget so the margin is theirs too.
 */
export const CHUNK_MAX_PAGES = 20;

/** Rows per Xero page. The cap is `CHUNK_MAX_PAGES * PAGE_SIZE`. */
const PAGE_SIZE = 100;

/**
 * Warn once a source passes this share of its page budget.
 *
 * Truncation is already a hard failure, but it fails AFTER the fact. This fires while there is
 * still headroom, because the volume that decides it is JENKI's trading rate — it rises on its
 * own, and the first sign should not be a discarded chunk.
 */
const NEAR_CAP_RATIO = 0.8;

export interface ChunkOutcome {
  window: DateWindow;
  /** False means at least one source hit its page bound; the records were discarded. */
  complete: boolean;
  /** Which sources truncated. Empty when complete. */
  truncatedSources: string[];
  counts: Record<keyof ChunkRecords, number>;
  /** How many times a 429 forced this chunk to be retried. */
  retries: number;
  /**
   * Sources that came back above 80% of their page budget. Not a failure — a warning that
   * this window is approaching the point where it will be discarded.
   */
  nearCap: string[];
}

export interface ChunkedReadResult {
  /** Newest chunk first. Includes the failed chunk, if there was one. */
  chunks: ChunkOutcome[];
  /** Every COMPLETE chunk's records, concatenated. Deduping runs on this, never per chunk. */
  merged: ChunkRecords;
  /** The span read completely, or null if not even the newest chunk could be. */
  covered: DateWindow | null;
  /** Days of history asked for. */
  requestedDays: number;
  /** Days actually covered completely. */
  completeDays: number;
  /** Set when a chunk could not be read completely. */
  stoppedAt: { window: DateWindow; truncatedSources: string[] } | null;
  /** True only when the whole requested span was read completely. */
  complete: boolean;
  /** Human-readable near-cap warnings across all chunks. Empty is the healthy state. */
  warnings: string[];
}

export interface ChunkedReadOptions {
  /** Total days of history to cover, walking backwards from `now`. */
  days: number;
  /**
   * Chunk size. Defaults to the measured-safe 30 and should be left alone — see the module
   * comment. Exposed for tests, not for tuning.
   */
  chunkDays?: number;
  /** Page budget per source per chunk. Defaults to CHUNK_MAX_PAGES — see its note. */
  now?: Date;
  maxPages?: number;
  /**
   * Gap between source fetches, matching the pacing used in the survey probes.
   *
   * Each source paginates internally without spacing, so a chunk is a burst of roughly 19
   * calls against a 60/minute budget. The gaps keep the sustained rate under it; the 429
   * retry below is what makes that safe rather than merely likely.
   */
  spacingMs?: number;
  /** Extra gap between chunks, on top of `spacingMs`. */
  chunkSpacingMs?: number;
  /** 429 retries per chunk before giving up on it. */
  maxRetries?: number;
  /** Injectable so tests are not real-time. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function emptyRecords(): ChunkRecords {
  return {
    payments: [],
    batchPayments: [],
    overpayments: [],
    prepayments: [],
    bankTransactions: [],
  };
}

/** Maps a reconciliation source name back to its key in `ChunkRecords`. */
function countKey(source: string): keyof ChunkRecords {
  switch (source) {
    case "PAYMENT":
      return "payments";
    case "OVERPAYMENT":
      return "overpayments";
    case "PREPAYMENT":
      return "prepayments";
    default:
      return "bankTransactions";
  }
}

export async function readChunked(
  tenantId: string,
  options: ChunkedReadOptions,
): Promise<ChunkedReadResult> {
  const chunkDays = options.chunkDays ?? RECONCILIATION_WINDOW_DAYS;
  const now = options.now ?? new Date();
  const spacingMs = options.spacingMs ?? 1_100;
  const chunkSpacingMs = options.chunkSpacingMs ?? 15_000;
  const maxRetries = options.maxRetries ?? 3;
  const maxPages = options.maxPages ?? CHUNK_MAX_PAGES;
  const sleep = options.sleep ?? defaultSleep;
  const day = 86_400_000;

  const chunkCount = Math.ceil(options.days / chunkDays);
  const chunks: ChunkOutcome[] = [];
  const merged = emptyRecords();
  let completeDays = 0;
  let stoppedAt: ChunkedReadResult["stoppedAt"] = null;
  const warnings: string[] = [];

  for (let index = 0; index < chunkCount; index += 1) {
    // Newest chunk first, so a failure further back still leaves the most recent span usable.
    const untilMs = now.getTime() - index * chunkDays * day;
    const sinceMs = now.getTime() - Math.min((index + 1) * chunkDays, options.days) * day;
    // The NEWEST chunk deliberately has no upper bound. Setting one would format to
    // `Date<DateTime(today)` and silently exclude everything dated today.
    const window: DateWindow =
      index === 0 ? { since: new Date(sinceMs) } : { since: new Date(sinceMs), until: new Date(untilMs) };

    if (index > 0) await sleep(chunkSpacingMs);

    const outcome = await readOneChunk(tenantId, window, {
      maxPages,
      spacingMs,
      maxRetries,
      sleep,
    });
    chunks.push(outcome.outcome);
    for (const source of outcome.outcome.nearCap) {
      warnings.push(
        `${source}: ${outcome.outcome.counts[countKey(source)]} records in the chunk from ` +
          `${window.since.toISOString().slice(0, 10)} — over ${Math.round(NEAR_CAP_RATIO * 100)}% of the ` +
          `${maxPages * PAGE_SIZE}-record budget. Still complete, but this window is approaching the ` +
          `point where it will be discarded.`,
      );
    }

    if (!outcome.outcome.complete) {
      // Hard failure: discard this chunk's records and stop reaching further back. Mixing a
      // partial chunk into the merged set would make an incomplete total look complete.
      stoppedAt = { window, truncatedSources: outcome.outcome.truncatedSources };
      break;
    }

    merged.payments.push(...outcome.records.payments);
    merged.batchPayments.push(...outcome.records.batchPayments);
    merged.overpayments.push(...outcome.records.overpayments);
    merged.prepayments.push(...outcome.records.prepayments);
    merged.bankTransactions.push(...outcome.records.bankTransactions);
    completeDays += Math.round((untilMs - sinceMs) / day);
  }

  const completed = chunks.filter((chunk) => chunk.complete);
  const covered =
    completed.length === 0
      ? null
      : {
          since: completed[completed.length - 1]!.window.since,
          ...(completed[0]!.window.until ? { until: completed[0]!.window.until } : {}),
        };

  return {
    chunks,
    merged,
    covered,
    requestedDays: options.days,
    completeDays,
    stoppedAt,
    complete: stoppedAt === null && completeDays >= options.days,
    warnings,
  };
}

async function readOneChunk(
  tenantId: string,
  window: DateWindow,
  options: {
    maxPages: number;
    spacingMs: number;
    maxRetries: number;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<{ outcome: ChunkOutcome; records: ChunkRecords }> {
  const { maxPages, spacingMs, maxRetries, sleep } = options;
  let retries = 0;

  for (;;) {
    try {
      const fetchOptions = { window, maxPages };
      const payments = await fetchPayments(tenantId, fetchOptions);
      await sleep(spacingMs);
      const batchPayments = await fetchBatchPayments(tenantId, { window });
      await sleep(spacingMs);
      const overpayments = await fetchOverpayments(tenantId, fetchOptions);
      await sleep(spacingMs);
      const prepayments = await fetchPrepayments(tenantId, fetchOptions);
      await sleep(spacingMs);
      const bankTransactions = await fetchBankTransactions(tenantId, fetchOptions);

      const truncatedSources = [
        payments.truncated ? "PAYMENT" : null,
        batchPayments.truncated ? "BATCH_PAYMENT" : null,
        overpayments.truncated ? "OVERPAYMENT" : null,
        prepayments.truncated ? "PREPAYMENT" : null,
        bankTransactions.truncated ? "BANK_TRANSACTION" : null,
      ].filter((source): source is string => source !== null);

      const cap = maxPages * PAGE_SIZE;
      const records: ChunkRecords = {
        payments: payments.items,
        batchPayments: batchPayments.items,
        overpayments: overpayments.items,
        prepayments: prepayments.items,
        bankTransactions: bankTransactions.transactions,
      };

      // Near-cap is computed only for the sources that actually paginate. /BatchPayments is
      // a single unpaginated call, so a page budget means nothing there.
      const nearCap = (
        [
          ["PAYMENT", records.payments.length],
          ["OVERPAYMENT", records.overpayments.length],
          ["PREPAYMENT", records.prepayments.length],
          ["BANK_TRANSACTION", records.bankTransactions.length],
        ] as const
      )
        .filter(([, count]) => count >= cap * NEAR_CAP_RATIO)
        .map(([source]) => source as string);

      return {
        outcome: {
          window,
          complete: truncatedSources.length === 0,
          nearCap,
          truncatedSources,
          counts: {
            payments: records.payments.length,
            batchPayments: records.batchPayments.length,
            overpayments: records.overpayments.length,
            prepayments: records.prepayments.length,
            bankTransactions: records.bankTransactions.length,
          },
          retries,
        },
        // Always returned, including for an incomplete chunk, so the counts above stay
        // diagnosable. Discarding is the CALLER's job — it stops before merging — and keeping
        // a second guard here only looked like belt-and-braces: no test could tell the two
        // apart, which is exactly how untested branches get mistaken for protection.
        records,
      };
    } catch (error) {
      // A 429 is a pacing problem, not a data problem: back off and retry THIS chunk rather
      // than abandoning the whole read. Xero's Retry-After is honoured when present.
      if (error instanceof XeroRateLimitError && retries < maxRetries) {
        retries += 1;
        const waitMs =
          error.retryAfterSeconds !== null && error.retryAfterSeconds > 0
            ? error.retryAfterSeconds * 1000
            : 60_000 * retries;
        await sleep(waitMs);
        continue;
      }
      throw error;
    }
  }
}

/** Exposed so a caller can assert nothing was silently dropped. */
export function mergedCounts(result: ChunkedReadResult): Record<keyof ChunkRecords, number> {
  return {
    payments: result.merged.payments.length,
    batchPayments: result.merged.batchPayments.length,
    overpayments: result.merged.overpayments.length,
    prepayments: result.merged.prepayments.length,
    bankTransactions: result.merged.bankTransactions.length,
  };
}
