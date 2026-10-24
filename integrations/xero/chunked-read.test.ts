import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readChunked } from "./chunked-read";
import { clearChartOfAccountsCache } from "./client";
import { setXeroTokenStore, type XeroTokenState, type XeroTokenStore } from "./tokens";

/**
 * Chunked reads against a stubbed Xero. `sleep` is injected throughout, so these assert the
 * pacing and retry DECISIONS without spending the wall-clock time they describe.
 */

const TENANT = "tenant-1";
const NOW = new Date("2026-10-24T12:00:00Z");

class MemoryStore implements XeroTokenStore {
  constructor(public state: XeroTokenState | null) {}
  async read() { return this.state; }
  async write(state: XeroTokenState) { this.state = state; }
  async clear() { this.state = null; }
  async withRefreshLock<T>(fn: () => Promise<T>): Promise<T> { return fn(); }
}

function connectedState(): XeroTokenState {
  return {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: Date.now() + 1_800_000,
    scope: "accounting.transactions.read",
    activeTenantId: TENANT,
    connectedAt: "2026-01-01T00:00:00.000Z",
    connections: [
      { connectionId: "c-1", tenantId: TENANT, tenantName: "JENKI", tenantType: "ORGANISATION" },
    ],
  } as XeroTokenState;
}

let calls: string[] = [];

/** `rows` per source per request; >=100 makes a paginated source look truncated. */
function stub(rows: Record<string, number>, onCall?: (url: string) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      onCall?.(url);
      const key = ["Payments", "BatchPayments", "Overpayments", "Prepayments", "BankTransactions"]
        // longest first, so "BatchPayments" is not matched as "Payments"
        .sort((a, b) => b.length - a.length)
        .find((name) => url.includes(`/${name}`))!;
      const n = rows[key] ?? 0;
      const body = { [key]: Array.from({ length: n }, (_, i) => idFor(key, i)) };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
}

function idFor(key: string, i: number) {
  const suffix = `${key}-${i}-${Math.random().toString(36).slice(2, 8)}`;
  if (key === "Payments") return { PaymentID: suffix, PaymentType: "ACCPAYPAYMENT", Amount: 1 };
  if (key === "BatchPayments") return { BatchPaymentID: suffix, Type: "PAYBATCH", TotalAmount: 1 };
  if (key === "BankTransactions") return { BankTransactionID: suffix, Type: "SPEND", Total: 1 };
  return { OverpaymentID: suffix, Type: "SPEND-OVERPAYMENT", Total: 1 };
}

const noSleep = async () => {};

beforeEach(() => {
  calls = [];
  setXeroTokenStore(new MemoryStore(connectedState()));
  clearChartOfAccountsCache();
  vi.stubEnv("XERO_CLIENT_ID", "test-client");
  vi.stubEnv("XERO_CLIENT_SECRET", "test-secret");
  vi.stubEnv("XERO_REDIRECT_URI", "http://localhost:3000/api/xero/callback");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const windowsOf = () =>
  calls
    .map((url) => new URL(url).searchParams.get("where") ?? "")
    .filter((where) => where.includes("Date>="))
    .map((where) => where.replace(/Status[^&]*&&?/, ""));

describe("chunking", () => {
  it("covers 90 days as three 30-day chunks", async () => {
    stub({ Payments: 5, BatchPayments: 2, Overpayments: 1, Prepayments: 0, BankTransactions: 4 });
    const result = await readChunked(TENANT, { days: 90, now: NOW, sleep: noSleep });

    expect(result.chunks).toHaveLength(3);
    expect(result.chunks.every((c) => c.complete)).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.completeDays).toBe(90);
  });

  it("covers 180 days as six chunks", async () => {
    stub({ Payments: 1, BatchPayments: 1, Overpayments: 1, Prepayments: 0, BankTransactions: 1 });
    const result = await readChunked(TENANT, { days: 180, now: NOW, sleep: noSleep });
    expect(result.chunks).toHaveLength(6);
    expect(result.complete).toBe(true);
    expect(result.completeDays).toBe(180);
  });

  it("uses a FIXED 30-day chunk, not one derived from record volume", async () => {
    // A high-volume stub must not change the chunk size -- the size is the known-safe
    // constant, and inferring it from density is what produced the 90-day failure.
    stub({ Payments: 99, BatchPayments: 99, Overpayments: 99, Prepayments: 0, BankTransactions: 99 });
    const dense = await readChunked(TENANT, { days: 90, now: NOW, sleep: noSleep });
    calls = [];
    stub({ Payments: 1, BatchPayments: 1, Overpayments: 1, Prepayments: 0, BankTransactions: 1 });
    const sparse = await readChunked(TENANT, { days: 90, now: NOW, sleep: noSleep });
    expect(dense.chunks).toHaveLength(sparse.chunks.length);
  });

  it("leaves the newest chunk's upper bound OPEN, so today is not excluded", async () => {
    // An upper bound would format to Date<DateTime(today) and silently drop today's records.
    stub({ Payments: 1, BatchPayments: 1, Overpayments: 1, Prepayments: 0, BankTransactions: 1 });
    const result = await readChunked(TENANT, { days: 90, now: NOW, sleep: noSleep });
    expect(result.chunks[0]!.window.until).toBeUndefined();
    expect(result.chunks[1]!.window.until).toBeDefined();
  });

  it("abuts chunks without overlapping, so nothing is counted twice or skipped", async () => {
    stub({ Payments: 1, BatchPayments: 1, Overpayments: 1, Prepayments: 0, BankTransactions: 1 });
    const result = await readChunked(TENANT, { days: 90, now: NOW, sleep: noSleep });
    // chunk 0 since == chunk 1 until, and so on: a record on the boundary day belongs to the
    // newer chunk only, because `since` is inclusive and `until` exclusive.
    expect(result.chunks[1]!.window.until!.getTime()).toBe(result.chunks[0]!.window.since.getTime());
    expect(result.chunks[2]!.window.until!.getTime()).toBe(result.chunks[1]!.window.since.getTime());
  });

  it("sends a date bound on every request of every chunk", async () => {
    stub({ Payments: 1, BatchPayments: 1, Overpayments: 1, Prepayments: 0, BankTransactions: 1 });
    await readChunked(TENANT, { days: 60, now: NOW, sleep: noSleep });
    const dated = windowsOf();
    expect(dated.length).toBe(calls.length);
    // Two chunks, so two distinct lower bounds.
    expect(new Set(dated.map((w) => /Date>=DateTime\([^)]*\)/.exec(w)![0])).size).toBe(2);
  });

  it("reports the covered span across chunks", async () => {
    stub({ Payments: 1, BatchPayments: 1, Overpayments: 1, Prepayments: 0, BankTransactions: 1 });
    const result = await readChunked(TENANT, { days: 90, now: NOW, sleep: noSleep });
    expect(result.covered!.since.toISOString()).toBe("2026-07-26T12:00:00.000Z");
  });
});

describe("truncation is a hard failure, not a warning", () => {
  it("stops extending back when a source truncates", async () => {
    // A full page of 100 means Xero had more and we stopped asking.
    let chunkIndex = -1;
    stub({ Payments: 5, BatchPayments: 2, Overpayments: 1, Prepayments: 0, BankTransactions: 4 });
    // Make the SECOND chunk's payments truncate.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/Payments") && !url.includes("/BatchPayments")) {
          const page = new URL(url).searchParams.get("page");
          if (page === "1") chunkIndex += 1;
          const n = chunkIndex === 1 ? 100 : 5;
          return json({ Payments: Array.from({ length: n }, (_, i) => idFor("Payments", i)) });
        }
        if (url.includes("/BatchPayments")) return json({ BatchPayments: [] });
        if (url.includes("/Overpayments")) return json({ Overpayments: [] });
        if (url.includes("/Prepayments")) return json({ Prepayments: [] });
        return json({ BankTransactions: [] });
      }),
    );

    const result = await readChunked(TENANT, {
      days: 90,
      now: NOW,
      maxPages: 1,
      sleep: noSleep,
    });

    expect(result.complete).toBe(false);
    expect(result.stoppedAt).not.toBeNull();
    expect(result.stoppedAt!.truncatedSources).toEqual(["PAYMENT"]);
    // Stopped: chunk 3 was never attempted.
    expect(result.chunks).toHaveLength(2);
    expect(result.completeDays).toBe(30);
  });

  it("DISCARDS the incomplete chunk's records rather than mixing them in", async () => {
    // This is the whole point. A partial chunk merged alongside complete ones produces a total
    // that looks complete, which is worse than one that is visibly short.
    stub({ Payments: 100, BatchPayments: 0, Overpayments: 0, Prepayments: 0, BankTransactions: 0 });
    const result = await readChunked(TENANT, { days: 90, now: NOW, maxPages: 1, sleep: noSleep });
    expect(result.stoppedAt).not.toBeNull();
    expect(result.merged.payments).toHaveLength(0);
    expect(result.completeDays).toBe(0);
    expect(result.covered).toBeNull();
    // The counts are still reported, so the failure is diagnosable.
    expect(result.chunks[0]!.counts.payments).toBe(100);
    expect(result.chunks[0]!.complete).toBe(false);
  });

  it("names every truncated source, not just the first", async () => {
    stub({ Payments: 100, BatchPayments: 0, Overpayments: 100, Prepayments: 0, BankTransactions: 100 });
    const result = await readChunked(TENANT, { days: 30, now: NOW, maxPages: 1, sleep: noSleep });
    expect(result.stoppedAt!.truncatedSources).toEqual([
      "PAYMENT",
      "OVERPAYMENT",
      "BANK_TRANSACTION",
    ]);
  });

  it("keeps the newest chunk when only an older one fails", async () => {
    // Partial coverage is still useful, provided the boundary is stated.
    let seen = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/BankTransactions")) {
          seen += 1;
          return json({ BankTransactions: Array.from({ length: seen === 1 ? 1 : 100 }, (_, i) => idFor("BankTransactions", i)) });
        }
        if (url.includes("/BatchPayments")) return json({ BatchPayments: [] });
        if (url.includes("/Overpayments")) return json({ Overpayments: [] });
        if (url.includes("/Prepayments")) return json({ Prepayments: [] });
        return json({ Payments: [] });
      }),
    );
    const result = await readChunked(TENANT, { days: 60, now: NOW, maxPages: 1, sleep: noSleep });
    expect(result.completeDays).toBe(30);
    expect(result.merged.bankTransactions).toHaveLength(1);
    expect(result.stoppedAt!.truncatedSources).toEqual(["BANK_TRANSACTION"]);
  });
});

describe("merging happens before deduping", () => {
  it("concatenates each source across chunks into one set", async () => {
    stub({ Payments: 3, BatchPayments: 2, Overpayments: 1, Prepayments: 0, BankTransactions: 4 });
    const result = await readChunked(TENANT, { days: 90, now: NOW, sleep: noSleep });
    // Three chunks x the per-chunk counts. Dedupe runs on this merged set, never per chunk,
    // because a batch's member payments could in principle fall in different chunks.
    expect(result.merged.payments).toHaveLength(9);
    expect(result.merged.batchPayments).toHaveLength(6);
    expect(result.merged.overpayments).toHaveLength(3);
    expect(result.merged.bankTransactions).toHaveLength(12);
    expect(result.merged.prepayments).toHaveLength(0);
  });

  it("does not dedupe or reorder — that is the reconciliation's job", async () => {
    stub({ Payments: 2, BatchPayments: 0, Overpayments: 0, Prepayments: 0, BankTransactions: 0 });
    const result = await readChunked(TENANT, { days: 60, now: NOW, sleep: noSleep });
    expect(result.merged.payments).toHaveLength(4);
    expect(new Set(result.merged.payments.map((p) => p.PaymentID)).size).toBe(4);
  });
});

describe("rate limiting", () => {
  it("spaces calls within a chunk and between chunks", async () => {
    const slept: number[] = [];
    stub({ Payments: 1, BatchPayments: 1, Overpayments: 1, Prepayments: 0, BankTransactions: 1 });
    await readChunked(TENANT, {
      days: 60,
      now: NOW,
      sleep: async (ms) => { slept.push(ms); },
    });
    // Four intra-chunk gaps per chunk (five sources), plus one between the two chunks.
    expect(slept.filter((ms) => ms === 1_100)).toHaveLength(8);
    expect(slept.filter((ms) => ms === 15_000)).toHaveLength(1);
  });

  it("retries the chunk on a 429 instead of abandoning the read", async () => {
    const slept: number[] = [];
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        calls.push(url);
        if (first && url.includes("/Payments") && !url.includes("/BatchPayments")) {
          first = false;
          return {
            ok: false,
            status: 429,
            headers: { get: (n: string) => (n.toLowerCase() === "retry-after" ? "7" : null) },
            text: async () => "rate limited",
          } as unknown as Response;
        }
        if (url.includes("/BatchPayments")) return json({ BatchPayments: [] });
        if (url.includes("/Overpayments")) return json({ Overpayments: [] });
        if (url.includes("/Prepayments")) return json({ Prepayments: [] });
        if (url.includes("/BankTransactions")) return json({ BankTransactions: [] });
        return json({ Payments: [idFor("Payments", 0)] });
      }),
    );

    const result = await readChunked(TENANT, {
      days: 30,
      now: NOW,
      sleep: async (ms) => { slept.push(ms); },
    });

    expect(result.complete).toBe(true);
    expect(result.chunks[0]!.retries).toBe(1);
    // Honours Retry-After rather than guessing.
    expect(slept).toContain(7_000);
    expect(result.merged.payments).toHaveLength(1);
  });

  it("gives up on a chunk after maxRetries, rather than looping forever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        calls.push(String(input));
        return {
          ok: false,
          status: 429,
          headers: { get: () => null },
          text: async () => "rate limited",
        } as unknown as Response;
      }),
    );
    await expect(
      readChunked(TENANT, { days: 30, now: NOW, maxRetries: 2, sleep: noSleep }),
    ).rejects.toThrow(/rate limit reached/);
  });

  it("backs off progressively when Retry-After is absent", async () => {
    const slept: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        calls.push(String(input));
        return {
          ok: false,
          status: 429,
          headers: { get: () => null },
          text: async () => "rate limited",
        } as unknown as Response;
      }),
    );
    await readChunked(TENANT, { days: 30, now: NOW, maxRetries: 2, sleep: async (ms) => { slept.push(ms); } })
      .catch(() => undefined);
    expect(slept).toEqual([60_000, 120_000]);
  });
});

function json(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
