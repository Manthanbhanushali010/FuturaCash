import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BATCH_MEMBER_MAX_PAGES,
  fetchBatchMemberPayments,
  fetchBatchPaymentById,
} from "./client";
import { setXeroTokenStore, type XeroTokenState, type XeroTokenStore } from "./tokens";

/**
 * The request `fetchBatchMemberPayments` actually sends, against a stubbed Xero.
 *
 * This is the half that cannot be unit tested through the projection: whether the batch
 * filter is in the query at all, whether paging stops on a short page, and whether the cap is
 * reported rather than silently applied. `Statuses=` has been silently ignored on three
 * endpoint families, so "the filter is in the URL" is worth asserting on its own.
 */

const TENANT = "tenant-under-test";
const BATCH_ID = "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";

class MemoryStore implements XeroTokenStore {
  constructor(public state: XeroTokenState | null) {}
  async read() {
    return this.state;
  }
  async write(state: XeroTokenState) {
    this.state = state;
  }
  async clear() {
    this.state = null;
  }
  async withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

let urls: string[] = [];

function stub(handler: (url: string) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(handler(url)),
      } as unknown as Response;
    }),
  );
}

function payments(count: number, batchId: string = BATCH_ID) {
  return {
    Payments: Array.from({ length: count }, (_, i) => ({
      PaymentID: `p-${i}`,
      BatchPaymentID: batchId,
      BankAmount: 1,
    })),
  };
}

function pageOf(url: string): number {
  return Number(new URL(url).searchParams.get("page"));
}

beforeEach(() => {
  urls = [];
  setXeroTokenStore(
    new MemoryStore({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 30 * 60 * 1000,
      scope: "accounting.payments.read",
      connections: [
        {
          connectionId: "c-1",
          tenantId: TENANT,
          tenantName: "Synthetic Org",
          tenantType: "ORGANISATION",
        },
      ],
      activeTenantId: TENANT,
      connectedAt: "2026-07-01T00:00:00.000Z",
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchBatchMemberPayments — the request", () => {
  it("filters on BatchPaymentID with a guid() literal", async () => {
    stub(() => payments(1));
    await fetchBatchMemberPayments(TENANT, BATCH_ID);
    const where = new URL(urls[0]!).searchParams.get("where");
    expect(where).toBe(`BatchPaymentID==guid("${BATCH_ID}")`);
  });

  it("sends `page`, which this endpoint honours", async () => {
    stub(() => payments(1));
    await fetchBatchMemberPayments(TENANT, BATCH_ID);
    expect(new URL(urls[0]!).searchParams.get("page")).toBe("1");
  });

  it("orders newest first", async () => {
    stub(() => payments(1));
    await fetchBatchMemberPayments(TENANT, BATCH_ID);
    expect(new URL(urls[0]!).searchParams.get("order")).toBe("Date DESC");
  });

  it("reads /Payments, not /BatchPayments", async () => {
    stub(() => payments(1));
    await fetchBatchMemberPayments(TENANT, BATCH_ID);
    expect(urls[0]).toContain("/Payments?");
  });

  /**
   * Deliberately unfiltered by status, unlike `fetchPayments`.
   *
   * The footer has to tie to the batch's own total, and that total covers the batch's members
   * whatever their status. A status filter would drop members and manufacture a mismatch.
   */
  it("does NOT add a status filter", async () => {
    stub(() => payments(1));
    await fetchBatchMemberPayments(TENANT, BATCH_ID);
    const where = new URL(urls[0]!).searchParams.get("where") ?? "";
    expect(where).not.toContain("Status");
    expect(where).not.toContain("&&");
    expect(new URL(urls[0]!).searchParams.get("Statuses")).toBeNull();
  });
});

describe("fetchBatchMemberPayments — paging", () => {
  it("stops on a short page: 100 then 36 is 2 calls and 136 records", async () => {
    // The live shape of the 136-member batch.
    stub((url) => (pageOf(url) === 1 ? payments(100) : payments(36)));
    const result = await fetchBatchMemberPayments(TENANT, BATCH_ID);
    expect(urls).toHaveLength(2);
    expect(result.items).toHaveLength(136);
    expect(result.truncated).toBe(false);
  });

  it("makes exactly one call when the first page is short", async () => {
    stub(() => payments(3));
    const result = await fetchBatchMemberPayments(TENANT, BATCH_ID);
    expect(urls).toHaveLength(1);
    expect(result.items).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it("caps at 5 pages and REPORTS it", async () => {
    stub(() => payments(100));
    const result = await fetchBatchMemberPayments(TENANT, BATCH_ID);
    expect(urls).toHaveLength(BATCH_MEMBER_MAX_PAGES);
    expect(BATCH_MEMBER_MAX_PAGES).toBe(5);
    expect(result.items).toHaveLength(500);
    // The flag is the whole point: 500 rows of an unknown total must not read as complete.
    expect(result.truncated).toBe(true);
  });

  it("requests consecutive pages from 1", async () => {
    stub(() => payments(100));
    await fetchBatchMemberPayments(TENANT, BATCH_ID);
    expect(urls.map(pageOf)).toEqual([1, 2, 3, 4, 5]);
  });

  it("carries the filter on EVERY page, not just the first", async () => {
    stub(() => payments(100));
    await fetchBatchMemberPayments(TENANT, BATCH_ID);
    for (const url of urls) {
      expect(new URL(url).searchParams.get("where")).toBe(
        `BatchPaymentID==guid("${BATCH_ID}")`,
      );
    }
  });
});

describe("the GUID guard", () => {
  it.each([
    "not-a-guid",
    "",
    `${BATCH_ID}")||Status=="AUTHORISED`,
    "00000000-0000-0000-0000-000000000000",
    `../${BATCH_ID}`,
  ])("refuses %s WITHOUT making any Xero call", async (bad) => {
    stub(() => payments(1));
    await expect(fetchBatchMemberPayments(TENANT, bad)).rejects.toThrow(/GUID/);
    // The budget matters: a malformed URL must cost nothing.
    expect(urls).toHaveLength(0);
  });

  it("refuses a non-GUID on the single-batch read too", async () => {
    stub(() => ({ BatchPayments: [] }));
    await expect(fetchBatchPaymentById(TENANT, "nope")).rejects.toThrow(/GUID/);
    expect(urls).toHaveLength(0);
  });
});

describe("fetchBatchPaymentById", () => {
  it("puts the id in the PATH and makes one call", async () => {
    stub(() => ({ BatchPayments: [{ BatchPaymentID: BATCH_ID, TotalAmount: 1 }] }));
    const batch = await fetchBatchPaymentById(TENANT, BATCH_ID);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(`/BatchPayments/${BATCH_ID}`);
    expect(batch?.BatchPaymentID).toBe(BATCH_ID);
  });

  it("returns null when Xero knows no such batch", async () => {
    stub(() => ({ BatchPayments: [] }));
    expect(await fetchBatchPaymentById(TENANT, BATCH_ID)).toBeNull();
  });
});
