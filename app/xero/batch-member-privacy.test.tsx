import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildBatchPaymentCard } from "@/integrations/xero/batch-card";
import type { XeroBatchPayment } from "@/integrations/xero/schemas";
import { BatchPaymentsView, type BatchPaymentsView as View } from "./batch-payments-view";

/**
 * Supplier detail nested inside a batch payment must not reach the browser.
 *
 * `GET /BatchPayments` returns each batch with its member payments inlined, and those members
 * carry `BankAccountNumber` — a supplier's actual bank account number, populated on 4,566 of
 * JENKI's 9,236 live members (surveyed 2026-11-01). Nothing on the card needs it. The card
 * shows a member COUNT and a summed total, so the whole member array is a pass-through that
 * exists only because Xero chose to inline it.
 *
 * `/xero` sits behind one shared password with no per-viewer identity, so anything rendered
 * there is effectively published to whoever holds that password. These assertions are what
 * stops a future change — a drill-down, a debug dump, a client component — from shipping
 * supplier bank details by accident.
 *
 * The synthetic values below are deliberately recognisable: a 14-digit run matching the live
 * format, and names that appear nowhere in JENKI's data.
 */

const ACCOUNT_NUMBER = "99999999999999";
const PAYEE = "Zzyzx Synthetic Supplies Ltd";
const INVOICE_NUMBER = "SYNTH-0001";

function batchWithSupplierDetail(overrides: Partial<XeroBatchPayment> = {}): XeroBatchPayment {
  return {
    BatchPaymentID: "batch-synthetic-1",
    Type: "PAYBATCH",
    Status: "AUTHORISED",
    DateString: "2026-10-30T00:00:00",
    Date: "2026-10-30T00:00:00",
    TotalAmount: 300,
    Account: { AccountID: "acct-1", CurrencyCode: "GBP" },
    Payments: [
      {
        PaymentID: "pay-1",
        Amount: 100,
        BankAmount: 100,
        BankAccountNumber: ACCOUNT_NUMBER,
        Details: PAYEE,
        Invoice: { InvoiceID: "inv-1", InvoiceNumber: INVOICE_NUMBER },
      },
      {
        PaymentID: "pay-2",
        Amount: 200,
        BankAmount: 200,
        BankAccountNumber: ACCOUNT_NUMBER,
        Invoice: { InvoiceID: "inv-2" },
      },
    ],
    ...overrides,
  } as XeroBatchPayment;
}

const SECRETS = [ACCOUNT_NUMBER, PAYEE, INVOICE_NUMBER];

const readyView = (card: ReturnType<typeof buildBatchPaymentCard>): View => ({
  kind: "READY",
  card,
  windowSince: "2026-10-02",
  windowDays: 30,
});

describe("the batch view model", () => {
  it("drops every member field at the boundary, keeping only the count and the sum", () => {
    const card = buildBatchPaymentCard([batchWithSupplierDetail()], { fallbackCurrency: "GBP" });

    const row = card.rows[0]!;
    expect(row.memberCount).toBe(2);
    expect(row.memberTotal.minor).toBe(30_000);

    // Serialised, because a leak could hide in any nested field rather than a known one.
    const serialised = JSON.stringify(card.rows);
    for (const secret of SECRETS) {
      expect(serialised).not.toContain(secret);
    }
  });

  it("keeps no member array on the row at all", () => {
    const card = buildBatchPaymentCard([batchWithSupplierDetail()], { fallbackCurrency: "GBP" });
    expect(card.rows[0]).not.toHaveProperty("members");
    expect(card.rows[0]).not.toHaveProperty("Payments");
  });
});

describe("the rendered card", () => {
  it("contains no supplier bank account number, payee or invoice number", () => {
    const card = buildBatchPaymentCard([batchWithSupplierDetail()], { fallbackCurrency: "GBP" });
    const html = renderToStaticMarkup(<BatchPaymentsView view={readyView(card)} />);

    for (const secret of SECRETS) {
      expect(html).not.toContain(secret);
    }
    // ...while still rendering the figures it is supposed to.
    expect(html).toContain("300.00 GBP");
    expect(html).toContain(">2<");
  });

  it("leaks nothing through a SCHEDULED batch either", () => {
    const card = buildBatchPaymentCard(
      [batchWithSupplierDetail({ DateString: "2099-01-01T00:00:00", Date: "2099-01-01T00:00:00" })],
      { fallbackCurrency: "GBP" },
    );
    expect(card.scheduled).toHaveLength(1);

    const html = renderToStaticMarkup(<BatchPaymentsView view={readyView(card)} />);
    for (const secret of SECRETS) {
      expect(html).not.toContain(secret);
    }
  });

  it("leaks nothing when a batch FAILS to normalise — the case that carries the raw payload", () => {
    // A failure is not hypothetical. An unsupported currency produces one by design, and
    // JENKI's chart of accounts already holds CAD, AUD and JPY wallets. The failure keeps the
    // whole raw batch for diagnosis, so this is the one path where supplier detail is still
    // in memory at render time.
    const card = buildBatchPaymentCard(
      [batchWithSupplierDetail({ Account: { AccountID: "a", CurrencyCode: "CNY" } })],
      { fallbackCurrency: null },
    );
    expect(card.failures).toHaveLength(1);
    expect(card.rows).toEqual([]);

    const html = renderToStaticMarkup(<BatchPaymentsView view={readyView(card)} />);
    for (const secret of SECRETS) {
      expect(html).not.toContain(secret);
    }
    // The reason is shown; the payload behind it is not.
    expect(html).toContain("could not be read");
  });
});

describe("the latent risk, pinned deliberately", () => {
  it("DOES still hold supplier detail in failures[].raw", () => {
    // Asserted so the risk is visible rather than assumed away. Nothing renders `raw` today
    // and there are no client components, so server-component props are never serialised to
    // the browser — which is why the live page is clean. Both of those are conventions, not
    // enforced boundaries. If `raw` is ever rendered, logged, or passed across a client
    // boundary, this is the field that leaks, and this test says so out loud.
    const card = buildBatchPaymentCard(
      [batchWithSupplierDetail({ Account: { AccountID: "a", CurrencyCode: "CNY" } })],
      { fallbackCurrency: null },
    );

    expect(JSON.stringify(card.failures[0]!.raw)).toContain(ACCOUNT_NUMBER);
  });
});
